import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    // `prisma generate`/`next build` 不连接数据库；占位地址让无生产密钥的
    // Docker 构建也能完成。运行时仍必须提供真实 DATABASE_URL。
    url:
      process.env.DATABASE_URL ??
      "mysql://build:build@127.0.0.1:3306/build_placeholder",
  },
});
