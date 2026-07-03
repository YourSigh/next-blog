import { NextResponse } from "next/server";
import { hasDownloadSession } from "@/lib/ops/download-auth";
import { listReleases } from "@/lib/ops/releases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await hasDownloadSession())) {
    return NextResponse.json({ error: "需要访问口令" }, { status: 401 });
  }

  try {
    const releases = (await listReleases()).map((release) => ({
      filename: release.filename,
      size: release.size,
      modifiedAt: release.modifiedAt,
      commit: release.commit,
      notes: release.notes,
      version: release.version,
      versionCode: release.versionCode,
    }));
    return NextResponse.json(
      { releases },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[apk-download] 读取 APK 列表失败", error);
    return NextResponse.json({ error: "安装包列表暂不可用" }, { status: 503 });
  }
}
