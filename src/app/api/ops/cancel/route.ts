import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops/auth";
import {
  cancelWorkflowRun,
  listWorkflowRuns,
  type OpsWorkflowKind,
} from "@/lib/ops/github";
import { isSameOrigin } from "@/lib/ops/request";

export const runtime = "nodejs";

const ALLOWED_ACTIONS = new Set<OpsWorkflowKind>(["deploy-api", "build-android"]);

function githubStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = /^GitHub API (\d+):/.exec(error.message);
  return match ? Number(match[1]) : null;
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }

  const session = await getOpsSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    action?: unknown;
    runId?: unknown;
  } | null;
  const action = body?.action;
  const runId = typeof body?.runId === "number" ? body.runId : Number(body?.runId);

  if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action as OpsWorkflowKind)) {
    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  }

  if (!Number.isSafeInteger(runId) || runId <= 0) {
    return NextResponse.json({ error: "无效的 Action Run ID" }, { status: 400 });
  }

  try {
    const runs = await listWorkflowRuns(action as OpsWorkflowKind, 20);
    const target = runs.find((run) => run.id === runId);

    if (!target) {
      return NextResponse.json({ error: "没有找到这条 Action 运行记录" }, { status: 404 });
    }

    if (target.status === "completed") {
      return NextResponse.json({ error: "这条 Action 已结束，无需取消" }, { status: 409 });
    }

    await cancelWorkflowRun(runId);
    return NextResponse.json({ ok: true, runId }, { status: 202 });
  } catch (error) {
    const status = githubStatus(error);
    console.error("[ops] 取消工作流失败", error);
    return NextResponse.json(
      {
        error:
          status === 409
            ? "GitHub 表示这条 Action 已经结束或不能取消"
            : "取消 GitHub Action 失败，请检查令牌权限或任务状态",
      },
      { status: status === 409 ? 409 : 502 },
    );
  }
}
