import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops/auth";
import {
  enqueueBackupTask,
  getBackupTask,
  type BackupKind,
} from "@/lib/ops/backups";
import { isSameOrigin } from "@/lib/ops/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_KINDS = new Set<BackupKind>(["database", "complete", "stats"]);

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }
  const session = await getOpsSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { kind?: unknown } | null;
  const kind = body?.kind;
  if (typeof kind !== "string" || !ALLOWED_KINDS.has(kind as BackupKind)) {
    return NextResponse.json({ error: "不支持的备份类型" }, { status: 400 });
  }

  try {
    const task = await enqueueBackupTask(kind as BackupKind, session.username);
    return NextResponse.json({ ok: true, task }, { status: 202 });
  } catch (error) {
    console.error("[ops] 创建备份任务失败", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "创建备份任务失败" },
      { status: 503 },
    );
  }
}

export async function GET(request: Request) {
  const session = await getOpsSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const id = new URL(request.url).searchParams.get("id") || "";
  const task = await getBackupTask(id);
  if (!task) {
    return NextResponse.json({ error: "备份任务不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, task });
}
