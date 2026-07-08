import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getDeployWebhookConfig } from "./config";

const COUNTDOWN_API_IMAGE_PATTERN =
  /^crpi-lgty92ojoeq0mwd1\.cn-hangzhou\.personal\.cr\.aliyuncs\.com\/next-blog\/countdown-api:[a-f0-9]{40}$/;

export type CountdownDeployTask = {
  id: string;
  image: string;
  commit: string;
  runUrl?: string;
  requestedBy?: string;
  requestId?: string;
  queuedAt: string;
};

export type DeployTaskResult =
  | { status: "done"; task: CountdownDeployTask }
  | { status: "failed"; task: CountdownDeployTask }
  | { status: "timeout"; id: string };

function queueDir(...segments: string[]): string {
  return path.join(getDeployWebhookConfig().queueDir, ...segments);
}

function taskPath(status: "pending" | "processing" | "done" | "failed", id: string) {
  return queueDir(status, `${id}.json`);
}

async function ensureQueueDirectories() {
  await Promise.all(
    ["pending", "processing", "done", "failed", "logs"].map((directory) =>
      mkdir(queueDir(directory), { recursive: true }),
    ),
  );
}

export function assertCountdownApiImage(image: string): void {
  if (!COUNTDOWN_API_IMAGE_PATTERN.test(image)) {
    throw new Error("镜像地址无效");
  }
}

export async function enqueueCountdownDeployTask(input: {
  image: string;
  commit?: string;
  runUrl?: string;
  requestedBy?: string;
  requestId?: string;
}): Promise<CountdownDeployTask> {
  assertCountdownApiImage(input.image);
  await ensureQueueDirectories();

  const tag = input.image.split(":").at(-1) || "";
  const task: CountdownDeployTask = {
    id: `${Date.now()}-${tag.slice(0, 12)}-${randomUUID().slice(0, 8)}`,
    image: input.image,
    commit: input.commit || tag.slice(0, 7),
    runUrl: input.runUrl,
    requestedBy: input.requestedBy,
    requestId: input.requestId,
    queuedAt: new Date().toISOString(),
  };

  const pendingPath = taskPath("pending", task.id);
  const tmpPath = `${pendingPath}.tmp-${process.pid}`;
  await writeFile(tmpPath, JSON.stringify(task, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(tmpPath, pendingPath);

  return task;
}

async function readTaskIfExists(
  status: "done" | "failed",
  id: string,
): Promise<CountdownDeployTask | null> {
  try {
    return JSON.parse(await readFile(taskPath(status, id), "utf8")) as CountdownDeployTask;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function waitForCountdownDeployTask(
  id: string,
  timeoutSeconds: number,
): Promise<DeployTaskResult> {
  const deadline = Date.now() + Math.max(0, timeoutSeconds) * 1000;

  while (Date.now() <= deadline) {
    const done = await readTaskIfExists("done", id);
    if (done) return { status: "done", task: done };

    const failed = await readTaskIfExists("failed", id);
    if (failed) return { status: "failed", task: failed };

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return { status: "timeout", id };
}

