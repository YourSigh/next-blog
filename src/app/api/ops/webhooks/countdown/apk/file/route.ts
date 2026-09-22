import { NextResponse } from "next/server";
import { publishApkFile } from "@/lib/ops/apk-publish";
import { verifyDeployWebhook } from "@/lib/ops/webhook-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isOutOfStorageError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOSPC"
  );
}

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
    const outOfStorage = isOutOfStorageError(error);
    return NextResponse.json(
      {
        error: outOfStorage
          ? "服务器存储空间不足"
          : error instanceof Error
            ? error.message
            : "APK 文件发布失败",
      },
      { status: outOfStorage ? 507 : 400 },
    );
  }
}
