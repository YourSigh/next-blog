import { NextResponse } from "next/server";
import { listReleases } from "@/lib/ops/releases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const latest = (await listReleases()).find(
      (release) =>
        typeof release.versionCode === "number" && release.versionCode > 0,
    );

    return NextResponse.json(
      {
        latest: latest
          ? {
              version: latest.version || "未知版本",
              versionCode: latest.versionCode,
              commit: latest.commit,
              notes: latest.notes,
              builtAt: latest.modifiedAt,
              downloadPageUrl: "https://yoursigh.top/countdown/download",
            }
          : null,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    console.error("[apk-update] 读取最新版本失败", error);
    return NextResponse.json({ error: "版本信息暂不可用" }, { status: 503 });
  }
}
