import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { hasAttachmentAccess } from "@/lib/attachments/auth";
import {
  getAttachmentContentType,
  getAttachmentPath,
  isSafeGroupName,
  isPreviewableImage,
} from "@/lib/attachments/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDisposition(filename: string, inline: boolean): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: Request) {
  if (!(await hasAttachmentAccess(request))) {
    return NextResponse.json({ error: "访问密钥无效或缺失" }, { status: 401 });
  }

  const url = new URL(request.url);
  const filename = url.searchParams.get("file") || "";
  const group = url.searchParams.get("group") || "";
  if (group && !isSafeGroupName(group)) {
    return NextResponse.json({ error: "分组名称无效" }, { status: 400 });
  }
  const filePath = getAttachmentPath(filename, group);
  if (!filePath) return NextResponse.json({ error: "文件名无效" }, { status: 400 });

  try {
    const fileStat = await lstat(filePath);
    if (!fileStat.isFile()) throw new Error("not a file");
    const inline = url.searchParams.get("preview") === "1" && isPreviewableImage(filename);
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>;
    return new NextResponse(stream, {
      headers: {
        "Content-Type": getAttachmentContentType(filename),
        "Content-Length": String(fileStat.size),
        "Content-Disposition": contentDisposition(filename, inline),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "附件不存在" }, { status: 404 });
    }
    console.error("[attachments] 附件读取失败", error);
    return NextResponse.json({ error: "附件读取失败" }, { status: 500 });
  }
}
