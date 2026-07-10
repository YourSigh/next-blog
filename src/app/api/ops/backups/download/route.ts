import { createReadStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops/auth";
import { getBackupArtifact } from "@/lib/ops/backups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOpsSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id") || "";
  const artifact = await getBackupArtifact(id);
  if (!artifact) {
    return NextResponse.json(
      { error: "备份文件不存在、尚未生成或已经下载删除" },
      { status: 404 },
    );
  }

  const source = createReadStream(artifact.path);
  let cleanupStarted = false;
  const cleanup = () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    void unlink(artifact.path).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("[ops] 删除已下载备份失败", error);
      }
    });
  };
  source.once("close", cleanup);
  source.once("error", cleanup);

  return new Response(
    Readable.toWeb(source) as unknown as ReadableStream<Uint8Array>,
    {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Length": String(artifact.size),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
