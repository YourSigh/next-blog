function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getOpsAuthConfig() {
  const sessionSecret = required("OPS_SESSION_SECRET");
  if (sessionSecret.length < 32) {
    throw new Error("OPS_SESSION_SECRET 至少需要 32 个字符");
  }

  return {
    username: required("OPS_ADMIN_USERNAME"),
    passwordHash: required("OPS_ADMIN_PASSWORD_HASH"),
    sessionSecret,
    maxFailures: positiveInteger("OPS_LOGIN_MAX_FAILURES", 5),
    failureWindowMinutes: positiveInteger("OPS_LOGIN_WINDOW_MINUTES", 15),
    lockMinutes: positiveInteger("OPS_LOGIN_LOCK_MINUTES", 60),
    sessionHours: positiveInteger("OPS_SESSION_HOURS", 12),
  };
}

export function getGitHubConfig() {
  return {
    token: required("OPS_GITHUB_TOKEN"),
    owner: process.env.OPS_GITHUB_OWNER?.trim() || "YourSigh",
    repository: process.env.OPS_GITHUB_REPOSITORY?.trim() || "countdown",
    ref: process.env.OPS_GITHUB_REF?.trim() || "main",
    deployWorkflow:
      process.env.OPS_GITHUB_DEPLOY_WORKFLOW?.trim() || "ops-deploy-api.yml",
    androidWorkflow:
      process.env.OPS_GITHUB_ANDROID_WORKFLOW?.trim() || "ops-build-android.yml",
  };
}

export function getReleasesDirectory(): string {
  return process.env.OPS_RELEASES_DIR?.trim() || "/app/releases";
}

export function getAttachmentsConfig() {
  return {
    directory: process.env.ATTACHMENTS_DIR?.trim() || "/app/attachments",
    maxFileSizeBytes:
      positiveInteger("ATTACHMENT_MAX_SIZE_MB", 20) * 1024 * 1024,
    maxRequestSizeBytes:
      positiveInteger("ATTACHMENT_MAX_REQUEST_SIZE_MB", 100) * 1024 * 1024,
  };
}

export function getDeployWebhookConfig() {
  const secret = required("DEPLOY_WEBHOOK_SECRET");
  if (secret.length < 32) {
    throw new Error("DEPLOY_WEBHOOK_SECRET 至少需要 32 个字符");
  }

  return {
    secret,
    queueDir: process.env.OPS_DEPLOY_QUEUE_DIR?.trim() || "/app/deploy-queue",
  };
}

export function getBackupQueueDirectory(): string {
  return process.env.OPS_BACKUP_QUEUE_DIR?.trim() || "/app/backup-queue";
}

export function getApkDownloadConfig() {
  const sessionSecret = required("OPS_SESSION_SECRET");
  if (sessionSecret.length < 32) {
    throw new Error("OPS_SESSION_SECRET 至少需要 32 个字符");
  }

  return {
    accessKey: required("APK_DOWNLOAD_ACCESS_KEY"),
    sessionSecret,
    maxFailures: positiveInteger("APK_DOWNLOAD_MAX_FAILURES", 5),
    failureWindowMinutes: positiveInteger("APK_DOWNLOAD_WINDOW_MINUTES", 15),
    lockMinutes: positiveInteger("APK_DOWNLOAD_LOCK_MINUTES", 60),
    sessionDays: positiveInteger("APK_DOWNLOAD_SESSION_DAYS", 7),
  };
}
