import { hasDownloadSession, verifyDownloadAccessKey } from "@/lib/ops/download-auth";
import { isSameOrigin } from "@/lib/ops/request";

function getRequestAccessKey(request: Request): string {
  const authorization = request.headers.get("authorization")?.trim() || "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim().slice(0, 128);
  }

  return (request.headers.get("x-access-key") || "").trim().slice(0, 128);
}

export async function hasAttachmentAccess(
  request: Request,
  options: { mutation?: boolean } = {},
): Promise<boolean> {
  const suppliedKey = getRequestAccessKey(request);
  if (suppliedKey) return verifyDownloadAccessKey(suppliedKey);

  if (options.mutation && !isSameOrigin(request)) return false;
  return hasDownloadSession();
}
