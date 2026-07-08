import { createHash, timingSafeEqual } from "node:crypto";
import { getDeployWebhookConfig } from "./config";

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = sha256(left);
  const rightHash = sha256(right);
  return timingSafeEqual(leftHash, rightHash);
}

export function verifyDeployWebhook(request: Request): boolean {
  const authorization = request.headers.get("authorization")?.trim() || "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;

  const token = authorization.slice(prefix.length).trim();
  if (!token) return false;

  return safeEqual(token, getDeployWebhookConfig().secret);
}

