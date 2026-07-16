import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { getAttachmentsConfig } from "@/lib/ops/config";

const IMAGE_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const MIME_TYPES: Record<string, string> = {
  ...IMAGE_TYPES,
  ".csv": "text/csv; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain; charset=utf-8",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
};

function childPath(directory: string, name: string): string {
  return `${directory.replace(/\/+$/, "")}/${name}`;
}

export type AttachmentInfo = {
  filename: string;
  size: number;
  modifiedAt: string;
  contentType: string;
  isImage: boolean;
};

export type AttachmentGroup = {
  name: string;
  count: number;
};

export function isSafeAttachmentFilename(filename: string): boolean {
  return (
    filename.length > 0 &&
    filename.length <= 240 &&
    filename === path.basename(filename) &&
    filename !== "." &&
    filename !== ".." &&
    !/[\u0000-\u001f\u007f/\\]/.test(filename)
  );
}

export function isSafeGroupName(group: string): boolean {
  return (
    group.length > 0 &&
    group.length <= 80 &&
    group === group.trim() &&
    group === path.basename(group) &&
    group !== "." &&
    group !== ".." &&
    !/[\u0000-\u001f\u007f/\\]/.test(group)
  );
}

function sanitizeFilename(filename: string): string {
  const normalized = path.basename(filename.normalize("NFKC"))
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .trim();
  const safe = normalized || "attachment";
  const extension = path.extname(safe);
  const stem = path.basename(safe, extension).slice(0, 180) || "attachment";
  return `${stem}${extension.slice(0, 30)}`;
}

export function getAttachmentContentType(filename: string): string {
  return MIME_TYPES[path.extname(filename).toLowerCase()] || "application/octet-stream";
}

export function isPreviewableImage(filename: string): boolean {
  return Boolean(IMAGE_TYPES[path.extname(filename).toLowerCase()]);
}

function getGroupDirectory(group = ""): string | null {
  const directory = getAttachmentsConfig().directory;
  if (!group) return directory;
  if (!isSafeGroupName(group)) return null;
  return childPath(directory, group);
}

export function getAttachmentPath(filename: string, group = ""): string | null {
  if (!isSafeAttachmentFilename(filename)) return null;
  const directory = getGroupDirectory(group);
  return directory ? childPath(directory, filename) : null;
}

export async function listAttachments(group = ""): Promise<AttachmentInfo[]> {
  const directory = getGroupDirectory(group);
  if (!directory) throw new Error("分组名称无效");
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const items = await Promise.all(
    names.filter(isSafeAttachmentFilename).map(async (filename) => {
      const fileStat = await lstat(childPath(directory, filename));
      if (!fileStat.isFile()) return null;
      return {
        filename,
        size: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
        contentType: getAttachmentContentType(filename),
        isImage: isPreviewableImage(filename),
      } satisfies AttachmentInfo;
    }),
  );

  return items
    .filter((item): item is AttachmentInfo => item !== null)
    .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
}

export async function listAttachmentGroups(): Promise<AttachmentGroup[]> {
  const { directory } = getAttachmentsConfig();
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory, { withFileTypes: true });
  const rootCount = entries.filter(
    (entry) => entry.isFile() && isSafeAttachmentFilename(entry.name),
  ).length;
  const directories = entries.filter(
    (entry) => entry.isDirectory() && isSafeGroupName(entry.name),
  );
  const groups = await Promise.all(
    directories.map(async (entry) => ({
      name: entry.name,
      count: (await listAttachments(entry.name)).length,
    })),
  );
  return [{ name: "", count: rootCount }, ...groups.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))];
}

export async function createAttachmentGroup(input: string): Promise<AttachmentGroup> {
  const name = input.normalize("NFKC").trim();
  if (!isSafeGroupName(name)) throw new Error("分组名称无效，请使用 1 到 80 个普通字符");
  const { directory } = getAttachmentsConfig();
  await mkdir(directory, { recursive: true });
  try {
    await mkdir(childPath(directory, name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("该分组已经存在");
    }
    throw error;
  }
  return { name, count: 0 };
}

async function availableFilename(originalName: string, group = ""): Promise<string> {
  const directory = getGroupDirectory(group);
  if (!directory) throw new Error("分组名称无效");
  const safeName = sanitizeFilename(originalName);
  const extension = path.extname(safeName);
  const stem = path.basename(safeName, extension);

  for (let index = 0; index < 10_000; index += 1) {
    const candidate = index === 0 ? safeName : `${stem}-${index}${extension}`;
    try {
      await stat(childPath(directory, candidate));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return candidate;
      throw error;
    }
  }
  throw new Error("无法生成可用文件名");
}

export async function saveAttachment(file: File, group = ""): Promise<AttachmentInfo> {
  const { maxFileSizeBytes } = getAttachmentsConfig();
  const directory = getGroupDirectory(group);
  if (!directory) throw new Error("分组名称无效");
  if (!file.name || file.size <= 0) throw new Error("不能上传空文件");
  if (file.size > maxFileSizeBytes) {
    throw new Error(`单个文件不能超过 ${Math.floor(maxFileSizeBytes / 1024 / 1024)} MB`);
  }

  await mkdir(directory, { recursive: true });
  let filename = await availableFilename(file.name, group);
  let filePath = childPath(directory, filename);
  let handle;

  try {
    handle = await open(filePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o640);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    filename = `${Date.now()}-${sanitizeFilename(file.name)}`;
    filePath = childPath(directory, filename);
    handle = await open(filePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o640);
  }

  try {
    await handle.writeFile(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(filePath).catch(() => undefined);
    throw error;
  }
  await handle.close();

  const fileStat = await stat(filePath);
  return {
    filename,
    size: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    contentType: getAttachmentContentType(filename),
    isImage: isPreviewableImage(filename),
  };
}

export async function deleteAttachment(filename: string, group = ""): Promise<void> {
  const filePath = getAttachmentPath(filename, group);
  if (!filePath) throw new Error("附件路径无效");
  let fileStat;
  try {
    fileStat = await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("附件不存在");
    throw error;
  }
  if (!fileStat.isFile()) throw new Error("附件不存在");
  await unlink(filePath);
}
