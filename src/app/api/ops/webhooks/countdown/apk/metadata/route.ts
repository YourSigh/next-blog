import { NextResponse } from "next/server";
import { savePendingApkMetadata } from "@/lib/ops/apk-publish";
import { verifyDeployWebhook } from "@/lib/ops/webhook-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyDeployWebhook(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    filename?: unknown;
    commit?: unknown;
    runUrl?: unknown;
    builtAt?: unknown;
    notes?: unknown;
    version?: unknown;
    versionCode?: unknown;
  } | null;

  if (!body || typeof body.filename !== "string") {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  try {
    const metadata = await savePendingApkMetadata({
      filename: body.filename,
      commit: typeof body.commit === "string" ? body.commit : undefined,
      runUrl: typeof body.runUrl === "string" ? body.runUrl : undefined,
      builtAt: typeof body.builtAt === "string" ? body.builtAt : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      version: typeof body.version === "string" ? body.version : undefined,
      versionCode: Number(body.versionCode),
    });

    return NextResponse.json({ ok: true, filename: metadata.filename });
  } catch (error) {
    console.error("[ops-webhook] APK 元数据保存失败", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "APK 元数据保存失败" },
      { status: 400 },
    );
  }
}

