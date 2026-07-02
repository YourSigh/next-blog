import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops/auth";
import {
  dispatchWorkflow,
  type OpsWorkflowKind,
} from "@/lib/ops/github";
import { isSameOrigin } from "@/lib/ops/request";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = new Set<OpsWorkflowKind>(["deploy-api", "build-android"]);

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }

  const session = await getOpsSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action;
  if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action as OpsWorkflowKind)) {
    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  }

  try {
    const result = await dispatchWorkflow(action as OpsWorkflowKind, session.username);
    return NextResponse.json({ ok: true, ...result }, { status: 202 });
  } catch (error) {
    console.error("[ops] 触发工作流失败", error);
    return NextResponse.json(
      { error: "触发 GitHub Actions 失败，请检查令牌和工作流配置" },
      { status: 502 },
    );
  }
}
