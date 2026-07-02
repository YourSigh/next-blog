import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { verify } from "@node-rs/argon2";
import { getOpsAuthConfig } from "./config";
import { ensureOpsSchema, opsPrisma } from "./db";

export const OPS_SESSION_COOKIE = "ops_session";

type LockState = {
  locked: boolean;
  retryAfterSeconds: number;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function keyedHash(value: string): string {
  const { sessionSecret } = getOpsAuthConfig();
  return createHmac("sha256", sessionSecret).update(value).digest("hex");
}

function safeTextEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function throttleScopes(username: string, ip: string): string[] {
  const normalizedUsername = username.trim().toLocaleLowerCase("en-US");
  return [
    keyedHash(`pair:${normalizedUsername}\0${ip}`),
    keyedHash(`ip:${ip}`),
  ];
}

export async function getLockState(username: string, ip: string): Promise<LockState> {
  await ensureOpsSchema();
  const now = new Date();
  const rows = await opsPrisma.opsLoginThrottle.findMany({
    where: { scopeHash: { in: throttleScopes(username, ip) } },
  });

  const lockedUntil = rows.reduce<Date | null>((latest, row) => {
    if (!row.lockedUntil || row.lockedUntil <= now) return latest;
    return !latest || row.lockedUntil > latest ? row.lockedUntil : latest;
  }, null);

  return {
    locked: Boolean(lockedUntil),
    retryAfterSeconds: lockedUntil
      ? Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000))
      : 0,
  };
}

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  const config = getOpsAuthConfig();
  let passwordMatches = false;

  try {
    // 即使用户名错误也执行一次 Argon2 校验，避免通过耗时枚举用户名。
    passwordMatches = await verify(config.passwordHash, password);
  } catch (error) {
    console.error("[ops] OPS_ADMIN_PASSWORD_HASH 无法校验", error);
  }

  return safeTextEqual(username.trim(), config.username) && passwordMatches;
}

export async function recordLoginFailure(username: string, ip: string): Promise<LockState> {
  await ensureOpsSchema();
  const config = getOpsAuthConfig();
  const now = new Date();
  const windowMs = config.failureWindowMinutes * 60_000;
  const lockMs = config.lockMinutes * 60_000;

  await opsPrisma.$transaction(async (tx) => {
    for (const scopeHash of throttleScopes(username, ip)) {
      const current = await tx.opsLoginThrottle.findUnique({ where: { scopeHash } });
      const windowExpired =
        !current || now.getTime() - current.windowStartedAt.getTime() >= windowMs;
      const failureCount = windowExpired ? 1 : current.failureCount + 1;
      const lockedUntil =
        failureCount >= config.maxFailures
          ? new Date(now.getTime() + lockMs)
          : current?.lockedUntil && current.lockedUntil > now
            ? current.lockedUntil
            : null;

      await tx.opsLoginThrottle.upsert({
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
    }
  });

  return getLockState(username, ip);
}

export async function clearLoginFailures(username: string, ip: string): Promise<void> {
  await ensureOpsSchema();
  await opsPrisma.opsLoginThrottle.deleteMany({
    where: { scopeHash: { in: throttleScopes(username, ip) } },
  });
}

export async function createOpsSession(username: string) {
  await ensureOpsSchema();
  const { sessionHours } = getOpsAuthConfig();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionHours * 60 * 60_000);

  await opsPrisma.opsSession.create({
    data: { tokenHash: sha256(token), username, expiresAt },
  });

  // 顺手清掉过期会话，表会长期保持很小。
  await opsPrisma.opsSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  return { token, expiresAt };
}

export async function getOpsSession() {
  await ensureOpsSchema();
  const token = (await cookies()).get(OPS_SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await opsPrisma.opsSession.findUnique({
    where: { tokenHash: sha256(token) },
  });

  if (!session) return null;
  if (session.expiresAt <= new Date()) {
    await opsPrisma.opsSession.delete({ where: { tokenHash: session.tokenHash } });
    return null;
  }

  return session;
}

export async function deleteOpsSession(): Promise<void> {
  await ensureOpsSchema();
  const token = (await cookies()).get(OPS_SESSION_COOKIE)?.value;
  if (!token) return;

  await opsPrisma.opsSession.deleteMany({
    where: { tokenHash: sha256(token) },
  });
}
