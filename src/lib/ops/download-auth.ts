import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getApkDownloadConfig } from "./config";
import { ensureOpsSchema, opsPrisma } from "./db";

export const APK_DOWNLOAD_COOKIE = "apk_download_session";

type LockState = {
  locked: boolean;
  retryAfterSeconds: number;
};

function safeTextEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function sign(value: string): string {
  return createHmac("sha256", getApkDownloadConfig().sessionSecret)
    .update(value)
    .digest("hex");
}

function throttleScope(ip: string): string {
  return sign(`apk-download-ip:${ip}`);
}

export function verifyDownloadAccessKey(accessKey: string): boolean {
  return safeTextEqual(accessKey.trim(), getApkDownloadConfig().accessKey);
}

export async function getDownloadLockState(ip: string): Promise<LockState> {
  await ensureOpsSchema();
  const row = await opsPrisma.opsLoginThrottle.findUnique({
    where: { scopeHash: throttleScope(ip) },
  });
  const now = new Date();
  const lockedUntil = row?.lockedUntil && row.lockedUntil > now
    ? row.lockedUntil
    : null;

  return {
    locked: Boolean(lockedUntil),
    retryAfterSeconds: lockedUntil
      ? Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000))
      : 0,
  };
}

export async function recordDownloadFailure(ip: string): Promise<LockState> {
  await ensureOpsSchema();
  const config = getApkDownloadConfig();
  const scopeHash = throttleScope(ip);
  const now = new Date();
  const current = await opsPrisma.opsLoginThrottle.findUnique({
    where: { scopeHash },
  });
  const windowExpired =
    !current ||
    now.getTime() - current.windowStartedAt.getTime() >=
      config.failureWindowMinutes * 60_000;
  const failureCount = windowExpired ? 1 : current.failureCount + 1;
  const lockedUntil = failureCount >= config.maxFailures
    ? new Date(now.getTime() + config.lockMinutes * 60_000)
    : current?.lockedUntil && current.lockedUntil > now
      ? current.lockedUntil
      : null;

  await opsPrisma.opsLoginThrottle.upsert({
    where: { scopeHash },
    create: {
      scopeHash,
      failureCount,
      windowStartedAt: windowExpired ? now : current!.windowStartedAt,
      lockedUntil,
    },
    update: {
      failureCount,
      windowStartedAt: windowExpired ? now : current!.windowStartedAt,
      lockedUntil,
    },
  });

  return getDownloadLockState(ip);
}

export async function clearDownloadFailures(ip: string): Promise<void> {
  await ensureOpsSchema();
  await opsPrisma.opsLoginThrottle.deleteMany({
    where: { scopeHash: throttleScope(ip) },
  });
}

export function createDownloadSession() {
  const expiresAt = new Date(
    Date.now() + getApkDownloadConfig().sessionDays * 24 * 60 * 60_000,
  );
  const payload = `${expiresAt.getTime()}.${randomBytes(18).toString("base64url")}`;
  return {
    token: `${payload}.${sign(payload)}`,
    expiresAt,
  };
}

export async function hasDownloadSession(): Promise<boolean> {
  const token = (await cookies()).get(APK_DOWNLOAD_COOKIE)?.value;
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [expiresText, nonce, signature] = parts;
  const expiresAt = Number(expiresText);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !nonce) return false;

  return safeTextEqual(signature, sign(`${expiresText}.${nonce}`));
}
