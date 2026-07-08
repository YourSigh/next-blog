import { NextResponse } from "next/server";
import {
  enqueueCountdownDeployTask,
  waitForCountdownDeployTask,
} from "@/lib/ops/deploy-queue";
import { verifyDeployWebhook } from "@/lib/ops/webhook-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampWaitSeconds(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 540;
  return Math.max(0, Math.min(600, Math.trunc(parsed)));
}

export async function POST(request: Request) {
  if (!verifyDeployWebhook(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    image?: unknown;
    commit?: unknown;
    runUrl?: unknown;
    requestedBy?: unknown;
    requestId?: unknown;
    waitSeconds?: unknown;
  } | null;

  if (!body || typeof body.image !== "string") {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  try {
    const task = await enqueueCountdownDeployTask({
      image: body.image,
      commit: typeof body.commit === "string" ? body.commit : undefined,
      runUrl: typeof body.runUrl === "string" ? body.runUrl : undefined,
      requestedBy:
        typeof body.requestedBy === "string" ? body.requestedBy : undefined,
      requestId: typeof body.requestId === "string" ? body.requestId : undefined,
    });

    const result = await waitForCountdownDeployTask(
      task.id,
      clampWaitSeconds(body.waitSeconds),
    );

    if (result.status === "done") {
      return NextResponse.json({ ok: true, taskId: task.id, status: "done" });
    }
    if (result.status === "failed") {
      return NextResponse.json(
        { ok: false, taskId: task.id, status: "failed" },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { ok: false, taskId: task.id, status: "timeout" },
      { status: 504 },
    );
  } catch (error) {
    console.error("[ops-webhook] API 部署任务处理失败", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "部署任务处理失败" },
      { status: 400 },
    );
  }
}
