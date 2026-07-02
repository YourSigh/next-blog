import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getOpsSession();
    return NextResponse.json({
      authenticated: Boolean(session),
      username: session?.username ?? null,
    });
  } catch (error) {
    console.error("[ops] 无法读取登录状态", error);
    return NextResponse.json(
      { authenticated: false, error: "控制台数据库未就绪" },
      { status: 503 },
    );
  }
}
