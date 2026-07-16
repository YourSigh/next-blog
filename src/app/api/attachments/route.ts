import { NextResponse } from "next/server";
import { hasAttachmentAccess } from "@/lib/attachments/auth";
import { listAttachments, saveAttachment } from "@/lib/attachments/storage";
import { getAttachmentsConfig } from "@/lib/ops/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ error: "访问密钥无效或缺失" }, { status: 401 });
}

export async function GET(request: Request) {
  if (!(await hasAttachmentAccess(request))) return unauthorized();
  try {
    return NextResponse.json({ attachments: await listAttachments() });
  } catch (error) {
    console.error("[attachments] 列表读取失败", error);
    return NextResponse.json({ error: "附件列表读取失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await hasAttachmentAccess(request, { mutation: true }))) return unauthorized();

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "请使用 multipart/form-data 上传文件" }, { status: 400 });
  }

  const files = [...formData.getAll("files"), ...formData.getAll("file")]
    .filter((entry): entry is File => entry instanceof File);
  if (!files.length) {
    return NextResponse.json({ error: "请选择要上传的文件（字段名 file 或 files）" }, { status: 400 });
  }
  if (files.length > 20) {
    return NextResponse.json({ error: "一次最多上传 20 个文件" }, { status: 400 });
  }

  const { maxFileSizeBytes, maxRequestSizeBytes } = getAttachmentsConfig();
  const oversized = files.find((file) => file.size > maxFileSizeBytes);
  if (oversized) {
    return NextResponse.json(
      { error: `${oversized.name} 超过单文件大小限制` },
      { status: 413 },
    );
  }
  if (files.reduce((total, file) => total + file.size, 0) > maxRequestSizeBytes) {
    return NextResponse.json({ error: "本次上传的文件总大小超过限制" }, { status: 413 });
  }

  try {
    const attachments = [];
    for (const file of files) attachments.push(await saveAttachment(file));
    return NextResponse.json({ ok: true, attachments }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "附件上传失败";
    console.error("[attachments] 上传失败", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
