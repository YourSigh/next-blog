import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops/auth";
import { listWorkflowRuns } from "@/lib/ops/github";
import { listReleases } from "@/lib/ops/releases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getApiHealth() {
  const url =
    process.env.OPS_COUNTDOWN_HEALTH_URL?.trim() ||
    "http://countdown-api:4000/health";

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: null,
      error: error instanceof Error ? error.message : "连接失败",
    };
  }
}

export async function GET() {
  const session = await getOpsSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const [health, releases, deployRuns, androidRuns] = await Promise.all([
    getApiHealth(),
    listReleases().catch((error) => {
      console.error("[ops] 读取 APK 列表失败", error);
      return [];
    }),
    listWorkflowRuns("deploy-api").catch((error) => {
      console.error("[ops] 读取后端工作流失败", error);
      return [];
    }),
    listWorkflowRuns("build-android").catch((error) => {
      console.error("[ops] 读取 Android 工作流失败", error);
      return [];
    }),
  ]);

  return NextResponse.json({
    username: session.username,
    health,
    releases,
    workflows: {
      deployApi: deployRuns,
      buildAndroid: androidRuns,
    },
  });
}
