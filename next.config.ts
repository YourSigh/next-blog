import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 启用 standalone 输出模式，用于 Docker 部署
  output: 'standalone',

  // Argon2 使用平台原生绑定，由 Node.js 在服务端直接加载。
  serverExternalPackages: ['@node-rs/argon2'],

  // 桌面上存在其他 lockfile，明确当前仓库为 Turbopack 根目录。
  turbopack: {
    root: process.cwd(),
  },
  
  // 图片优化
  images: {
    unoptimized: true, // 在 Docker 环境中禁用图片优化
  },
};

export default nextConfig;
