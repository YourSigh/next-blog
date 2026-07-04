import { NextResponse } from "next/server";
import {
  clearDownloadFailures,
  createMobileDownloadToken,
  getDownloadLockState,
  recordDownloadFailure,
  verifyDownloadAccessKey,
  verifyMobileDownloadToken,
} from "@/lib/ops/download-auth";
import { isSafeReleaseFilename, listReleases } from "@/lib/ops/releases";
import { getClientIp } from "@/lib/ops/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const APK_PUBLIC_ORIGIN = "https://yoursigh.top";
const COUNTDOWN_AUTH_STATUS_URL = "http://countdown-api:4000/v1/auth/status";

async function validateAppAuthorization(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return "missing" as const;

  try {
    const response = await fetch(COUNTDOWN_AUTH_STATUS_URL, {
      headers: { Authorization: authorization },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (response.ok) return "valid" as const;
    if (response.status === 401 || response.status === 403) {
      return "invalid" as const;
    }
    return "unavailable" as const;
  } catch {
    return "unavailable" as const;
  }
}

export async function POST(request: Request) {
  let body: { accessKey?: unknown; versionCode?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const accessKey = typeof body.accessKey === "string"
    ? body.accessKey.slice(0, 128)
    : "";
  const versionCode = Number(body.versionCode);
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
    return NextResponse.json({ error: "版本信息无效" }, { status: 400 });
  }

  const ip = getClientIp(request);
  try {
    const appAuthorization = await validateAppAuthorization(request);
    if (appAuthorization === "invalid") {
      return NextResponse.json(
        { error: "设备登录已失效，请重新进入 App" },
        { status: 401 },
      );
    }
    if (appAuthorization === "unavailable") {
      return NextResponse.json(
        { error: "设备验证服务暂不可用" },
        { status: 503 },
      );
    }

    // 兼容已经安装的旧版 App；新版会直接使用设备登录 Token，不再要求口令。
    if (appAuthorization === "missing") {
      if (!accessKey) {
        return NextResponse.json({ error: "需要设备登录凭证" }, { status: 401 });
      }
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
              : "下载口令不正确",
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
    }

    const release = (await listReleases()).find(
      (item) => item.versionCode === versionCode,
    );
    if (!release) {
      return NextResponse.json(
        { error: "这个版本已不存在，请重新检查更新" },
        { status: 404 },
      );
    }

    const token = createMobileDownloadToken(release.filename);
    const downloadUrl = new URL("/api/apk/mobile-download", APK_PUBLIC_ORIGIN);
    downloadUrl.searchParams.set("file", release.filename);
    downloadUrl.searchParams.set("expires", String(token.expiresAt));
    downloadUrl.searchParams.set("signature", token.signature);

    return NextResponse.json({
      filename: release.filename,
      downloadUrl: downloadUrl.toString(),
      expiresAt: new Date(token.expiresAt).toISOString(),
    });
  } catch (error) {
    console.error("[apk-mobile-download] 创建下载任务失败", error);
    return NextResponse.json({ error: "下载服务暂不可用" }, { status: 503 });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const filename = url.searchParams.get("file") || "";
  const expiresAt = Number(url.searchParams.get("expires"));
  const signature = url.searchParams.get("signature") || "";

  if (
    !isSafeReleaseFilename(filename) ||
    !verifyMobileDownloadToken(filename, expiresAt, signature)
  ) {
    return NextResponse.json(
      { error: "下载链接无效或已过期" },
      { status: 403 },
    );
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
