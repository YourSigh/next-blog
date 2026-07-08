import { NextResponse } from "next/server";
import { publishApkFile } from "@/lib/ops/apk-publish";
import { verifyDeployWebhook } from "@/lib/ops/webhook-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyDeployWebhook(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const url = new URL(request.url);
  const filename = url.searchParams.get("filename") || "";

  try {
    const result = await publishApkFile(filename, request.body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[ops-webhook] APK 文件发布失败", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "APK 文件发布失败" },
      { status: 400 },
    );
  }
}

