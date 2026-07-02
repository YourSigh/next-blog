import { NextResponse } from "next/server";
import { OPS_SESSION_COOKIE, deleteOpsSession } from "@/lib/ops/auth";
import { isSameOrigin } from "@/lib/ops/request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "请求来源无效" }, { status: 403 });
  }

  await deleteOpsSession();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(OPS_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
