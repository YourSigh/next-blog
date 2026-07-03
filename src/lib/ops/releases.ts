import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getReleasesDirectory } from "./config";

const APK_FILE_PATTERN = /^countdown-[a-zA-Z0-9._-]+\.apk$/;

export type OpsRelease = {
  filename: string;
  size: number;
  modifiedAt: string;
  commit?: string;
  runUrl?: string;
  notes?: string;
  version?: string;
  versionCode?: number;
};

export function isSafeReleaseFilename(filename: string): boolean {
  return APK_FILE_PATTERN.test(filename) && path.basename(filename) === filename;
}

export async function listReleases(): Promise<OpsRelease[]> {
  const directory = getReleasesDirectory();
  let names: string[];

  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const releases = await Promise.all(
    names.filter(isSafeReleaseFilename).map(async (filename) => {
      const filePath = path.join(directory, filename);
      const fileStat = await stat(filePath);
      let metadata: {
        commit?: string;
        runUrl?: string;
        notes?: string;
        version?: string;
        versionCode?: number;
      } = {};

      try {
        metadata = JSON.parse(
          await readFile(`${filePath}.json`, "utf8"),
        ) as typeof metadata;
      } catch {
        // 老产物或人工上传的 APK 没有元数据也可以下载。
      }

      return {
        filename,
        size: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
        commit: metadata.commit,
        runUrl: metadata.runUrl,
        notes: metadata.notes,
        version: metadata.version,
        versionCode: Number.isInteger(metadata.versionCode)
          ? metadata.versionCode
          : undefined,
      };
    }),
  );

  return releases
    .sort(
      (left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt),
    )
    .slice(0, 5);
}
