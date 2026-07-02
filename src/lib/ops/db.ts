import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  opsPrisma?: PrismaClient;
};

export const opsPrisma =
  globalForPrisma.opsPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.opsPrisma = opsPrisma;
}

let schemaReady: Promise<void> | null = null;

/**
 * 让控制台第一次使用时自行创建两张小表，避免为现有 MySQL 增加一个常驻迁移容器。
 * DATABASE_URL 可以直接指向 countdown 数据库；表名使用 Ops 前缀，不会碰业务表。
 */
export function ensureOpsSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await opsPrisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS \`OpsLoginThrottle\` (
          \`scopeHash\` VARCHAR(64) NOT NULL,
          \`failureCount\` INT NOT NULL DEFAULT 0,
          \`windowStartedAt\` DATETIME(3) NOT NULL,
          \`lockedUntil\` DATETIME(3) NULL,
          \`updatedAt\` DATETIME(3) NOT NULL,
          PRIMARY KEY (\`scopeHash\`)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);

      await opsPrisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS \`OpsSession\` (
          \`tokenHash\` VARCHAR(64) NOT NULL,
          \`username\` VARCHAR(191) NOT NULL,
          \`expiresAt\` DATETIME(3) NOT NULL,
          \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
          PRIMARY KEY (\`tokenHash\`),
          INDEX \`OpsSession_expiresAt_idx\` (\`expiresAt\`)
        ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }

  return schemaReady;
}
