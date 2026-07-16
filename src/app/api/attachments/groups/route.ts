import { NextResponse } from "next/server";
import { hasAttachmentAccess } from "@/lib/attachments/auth";
import { createAttachmentGroup } from "@/lib/attachments/storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!(await hasAttachmentAccess(request, { mutation: true }))) {
    return NextResponse.json({ error: "访问密钥无效或缺失" }, { status: 401 });
  }

  let body: { name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (typeof body.name !== "string") {
    return NextResponse.json({ error: "请输入分组名称" }, { status: 400 });
  }

  try {
    const group = await createAttachmentGroup(body.name);
    return NextResponse.json({ ok: true, group }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "分组创建失败" },
      { status: 400 },
    );
  }
}
