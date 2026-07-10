import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getBackupQueueDirectory } from "./config";

export type BackupKind = "database" | "complete" | "stats";
export type BackupTaskState = "pending" | "processing" | "done" | "failed";

export type MediaCategoryStats = {
  bytes: number;
  files: number;
};

export type MediaStats = {
  measuredAt: string;
  firstFileAt: string | null;
  lastFileAt: string | null;
  observedDays: number;
  totalBytes: number;
  totalFiles: number;
  averageBytesPerDay: number;
  recent7DayBytes: number;
  recent7DayAverageBytes: number;
  categories: {
    voice: MediaCategoryStats;
    chatImages: MediaCategoryStats;
    timelineImages: MediaCategoryStats;
    other: MediaCategoryStats;
  };
};

export type BackupTask = {
  id: string;
  kind: BackupKind;
  requestedBy: string;
  queuedAt: string;
  completedAt?: string;
  artifactFileName?: string;
  artifactSize?: number;
  mediaStats?: MediaStats;
  error?: string;
};

export type BackupTaskResult = BackupTask & { state: BackupTaskState };

const TASK_ID_PATTERN = /^backup-[0-9]{13}-[a-f0-9-]{36}$/;
const ARTIFACT_PATTERN =
  /^countdown-(database|complete)-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}\.(sql\.gz|tar\.gz)$/;

function queuePath(...segments: string[]): string {
  return path.join(getBackupQueueDirectory(), ...segments);
}

function taskPath(state: BackupTaskState, id: string): string {
  return queuePath(state, `${id}.json`);
}

async function ensureDirectories(): Promise<void> {
  await Promise.all(
    ["pending", "processing", "done", "failed", "artifacts", "logs"].map(
      (directory) => mkdir(queuePath(directory), { recursive: true }),
    ),
  );
}

export function isBackupTaskId(value: string): boolean {
  return TASK_ID_PATTERN.test(value);
}

export async function enqueueBackupTask(
  kind: BackupKind,
  requestedBy: string,
): Promise<BackupTask> {
  await ensureDirectories();

  const activeTasks = await Promise.all(
    ["pending", "processing"].map(async (state) => {
      const entries = await readdir(queuePath(state)).catch(() => []);
      return entries.filter((entry) => entry.endsWith(".json")).length;
    }),
  );
  if (activeTasks.reduce((sum, count) => sum + count, 0) >= 3) {
    throw new Error("已有多个备份任务正在排队，请稍后再试");
  }

  const task: BackupTask = {
    id: `backup-${Date.now()}-${randomUUID()}`,
    kind,
    requestedBy,
    queuedAt: new Date().toISOString(),
  };
  const target = taskPath("pending", task.id);
  const temporary = `${target}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(task, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporary, target);
  return task;
}

async function readTask(state: BackupTaskState, id: string): Promise<BackupTask | null> {
  try {
    const task = JSON.parse(await readFile(taskPath(state, id), "utf8")) as BackupTask;
    if (task.id !== id || !["database", "complete", "stats"].includes(task.kind)) {
      throw new Error("备份任务内容无效");
    }
    return task;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function getBackupTask(id: string): Promise<BackupTaskResult | null> {
  if (!isBackupTaskId(id)) return null;
  await ensureDirectories();

  for (const state of ["done", "failed", "processing", "pending"] as const) {
    const task = await readTask(state, id);
    if (task) return { ...task, state };
  }
  return null;
}

export async function getBackupArtifact(id: string): Promise<{
  task: BackupTask;
  path: string;
  size: number;
  filename: string;
} | null> {
  const result = await getBackupTask(id);
  if (!result || result.state !== "done" || result.kind === "stats") return null;
  const filename = result.artifactFileName || "";
  if (!ARTIFACT_PATTERN.test(filename)) return null;

  const artifactPath = queuePath("artifacts", filename);
  try {
    const fileStat = await stat(artifactPath);
    if (!fileStat.isFile()) return null;
    return { task: result, path: artifactPath, size: fileStat.size, filename };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
