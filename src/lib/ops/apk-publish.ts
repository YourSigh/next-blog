import { createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getReleasesDirectory } from "./config";
import { isSafeReleaseFilename } from "./releases";

const MAX_APK_BYTES = 260 * 1024 * 1024;

type ApkMetadata = {
  filename: string;
  commit?: string;
  runUrl?: string;
  builtAt?: string;
  notes?: string;
  version?: string;
  versionCode?: number;
};

function incomingDirectory(): string {
  return path.join(getReleasesDirectory(), ".incoming");
}

function metadataPath(filename: string): string {
  return path.join(incomingDirectory(), `${filename}.json`);
}

function safeMetadata(input: ApkMetadata): ApkMetadata {
  if (!isSafeReleaseFilename(input.filename)) {
    throw new Error("APK 文件名无效");
  }

  return {
    filename: input.filename,
    commit:
      typeof input.commit === "string"
        ? input.commit.replace(/[^a-fA-F0-9]/g, "").slice(0, 40)
        : undefined,
    runUrl:
      typeof input.runUrl === "string" && input.runUrl.startsWith("https://github.com/")
        ? input.runUrl.slice(0, 500)
        : undefined,
    builtAt:
      typeof input.builtAt === "string"
        ? input.builtAt.slice(0, 80)
        : new Date().toISOString(),
    notes:
      typeof input.notes === "string"
        ? input.notes.replace(/\u0000/g, "").slice(0, 4000)
        : undefined,
    version:
      typeof input.version === "string"
        ? input.version.replace(/[^0-9A-Za-z._-]/g, "").slice(0, 40)
        : undefined,
    versionCode: Number.isSafeInteger(input.versionCode)
      ? input.versionCode
      : undefined,
  };
}

async function ensureReleaseDirectories() {
  await mkdir(getReleasesDirectory(), { recursive: true });
  await mkdir(incomingDirectory(), { recursive: true });
}

export async function savePendingApkMetadata(input: ApkMetadata) {
  await ensureReleaseDirectories();
  const metadata = safeMetadata(input);
  const target = metadataPath(metadata.filename);
  const tmp = `${target}.tmp-${process.pid}`;

  await writeFile(tmp, JSON.stringify(metadata, null, 2) + "\n", {
    encoding: "utf8",
  });
  await rename(tmp, target);

  return metadata;
}

async function cleanupOldReleases() {
  const directory = getReleasesDirectory();
  const names = await readdir(directory).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
    throw error;
  });

  const apks = await Promise.all(
    names.filter(isSafeReleaseFilename).map(async (filename) => ({
      filename,
      modifiedAt: (await stat(path.join(directory, filename))).mtime.getTime(),
    })),
  );

  const expired = apks
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(5);

  await Promise.all(
    expired.flatMap(({ filename }) => [
      rm(path.join(directory, filename), { force: true }),
      rm(path.join(directory, `${filename}.json`), { force: true }),
    ]),
  );

  await Promise.all(
    names
      .filter((name) => name.endsWith(".apk.json"))
      .map(async (metadata) => {
        const apk = metadata.slice(0, -".json".length);
        if (!isSafeReleaseFilename(apk)) return;
        try {
          await stat(path.join(directory, apk));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            await rm(path.join(directory, metadata), { force: true });
            return;
          }
          throw error;
        }
      }),
  );
}

async function cleanupIncoming() {
  const directory = incomingDirectory();
  const names = await readdir(directory).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [] as string[];
    throw error;
  });
  const cutoff = Date.now() - 24 * 60 * 60_000;

  await Promise.all(
    names.map(async (name) => {
      const file = path.join(directory, name);
      const fileStat = await stat(file);
      if (fileStat.mtime.getTime() < cutoff) {
        await rm(file, { force: true });
      }
    }),
  );
}

export async function publishApkFile(filename: string, body: ReadableStream<Uint8Array> | null) {
  if (!isSafeReleaseFilename(filename)) {
    throw new Error("APK 文件名无效");
  }
  if (!body) {
    throw new Error("缺少 APK 文件内容");
  }

  await ensureReleaseDirectories();
  await cleanupIncoming();

  const pendingMetadata = metadataPath(filename);
  let metadata: ApkMetadata;
  try {
    metadata = JSON.parse(await readFile(pendingMetadata, "utf8")) as ApkMetadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("缺少 APK 元数据，请先上传 metadata");
    }
    throw error;
  }

  safeMetadata({ ...metadata, filename });

  const incomingApk = path.join(incomingDirectory(), `${filename}.uploading`);
  const releaseApk = path.join(getReleasesDirectory(), filename);
  const releaseMetadata = `${releaseApk}.json`;

  let receivedBytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_APK_BYTES) {
        callback(new Error("APK 文件过大"));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(body as unknown as Parameters<typeof Readable.fromWeb>[0]),
      limiter,
      createWriteStream(incomingApk, { flags: "w", mode: 0o644 }),
    );

    if (receivedBytes <= 0) {
      throw new Error("APK 文件为空");
    }

    await rename(incomingApk, releaseApk);
    await rename(pendingMetadata, releaseMetadata);
    await cleanupOldReleases();

    return { filename, size: receivedBytes };
  } catch (error) {
    await rm(incomingApk, { force: true });
    throw error;
  }
}
