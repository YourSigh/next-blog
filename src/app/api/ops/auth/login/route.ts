import { NextResponse } from "next/server";
import {
  OPS_SESSION_COOKIE,
  clearLoginFailures,
  createOpsSession,
  getLockState,
  recordLoginFailure,
  verifyCredentials,
} from "@/lib/ops/auth";
import { getClientIp, isSameOrigin } from "@/lib/ops/request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username.slice(0, 191) : "";
  const password = typeof body.password === "string" ? body.password.slice(0, 512) : "";
  const ip = getClientIp(request);

  if (!username || !password) {
    return NextResponse.json({ error: "请输入账号和密码" }, { status: 400 });
  }

  try {
    const currentLock = await getLockState(username, ip);
    if (currentLock.locked) {
      return NextResponse.json(
        {
          error: "尝试次数过多，请稍后再试",
          retryAfter: currentLock.retryAfterSeconds,
        },
        {
          status: 429,
          headers: { "Retry-After": String(currentLock.retryAfterSeconds) },
        },
      );
    }

    const valid = await verifyCredentials(username, password);
    if (!valid) {
      const nextLock = await recordLoginFailure(username, ip);
      return NextResponse.json(
        {
          error: nextLock.locked
            ? "尝试次数过多，请稍后再试"
            : "账号或密码错误",
          retryAfter: nextLock.retryAfterSeconds || undefined,
        },
        {
          status: nextLock.locked ? 429 : 401,
          headers: nextLock.locked
            ? { "Retry-After": String(nextLock.retryAfterSeconds) }
            : undefined,
        },
      );
    }

    await clearLoginFailures(username, ip);
    const session = await createOpsSession(username.trim());
    const response = NextResponse.json({ ok: true, username: username.trim() });
    response.cookies.set(OPS_SESSION_COOKIE, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      expires: session.expiresAt,
    });
    return response;
  } catch (error) {
    console.error("[ops] 登录失败", error);
    return NextResponse.json({ error: "登录服务暂不可用" }, { status: 503 });
  }
}
