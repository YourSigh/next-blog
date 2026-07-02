import { NextResponse } from "next/server";
import { getOpsSession } from "@/lib/ops/auth";
import { isSafeReleaseFilename } from "@/lib/ops/releases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getOpsSession();
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const filename = new URL(request.url).searchParams.get("file") || "";
  if (!isSafeReleaseFilename(filename)) {
    return NextResponse.json({ error: "文件名无效" }, { status: 400 });
  }

  return new NextResponse(null, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
      "X-Accel-Redirect": `/_protected/countdown-releases/${encodeURIComponent(filename)}`,
    },
  });
}
