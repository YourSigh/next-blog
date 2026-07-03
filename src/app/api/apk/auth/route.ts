import { NextResponse } from "next/server";
import {
  APK_DOWNLOAD_COOKIE,
  clearDownloadFailures,
  createDownloadSession,
  getDownloadLockState,
  recordDownloadFailure,
  verifyDownloadAccessKey,
} from "@/lib/ops/download-auth";
import { getClientIp, isSameOrigin } from "@/lib/ops/request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }

  let body: { accessKey?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const accessKey = typeof body.accessKey === "string"
    ? body.accessKey.slice(0, 128)
    : "";
  if (!accessKey) {
    return NextResponse.json({ error: "请输入访问口令" }, { status: 400 });
  }

  const ip = getClientIp(request);
  try {
    const currentLock = await getDownloadLockState(ip);
    if (currentLock.locked) {
      return NextResponse.json(
        { error: "尝试次数过多，请稍后再试" },
        {
          status: 429,
          headers: { "Retry-After": String(currentLock.retryAfterSeconds) },
        },
      );
    }

    if (!verifyDownloadAccessKey(accessKey)) {
      const nextLock = await recordDownloadFailure(ip);
      return NextResponse.json(
        {
          error: nextLock.locked
            ? "尝试次数过多，请稍后再试"
            : "访问口令不正确",
        },
        {
          status: nextLock.locked ? 429 : 401,
          headers: nextLock.locked
            ? { "Retry-After": String(nextLock.retryAfterSeconds) }
            : undefined,
        },
      );
    }

    await clearDownloadFailures(ip);
    const session = createDownloadSession();
    const response = NextResponse.json({ ok: true });
    response.cookies.set(APK_DOWNLOAD_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  } catch (error) {
    console.error("[apk-download] 口令校验失败", error);
    return NextResponse.json({ error: "验证服务暂不可用" }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(APK_DOWNLOAD_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
