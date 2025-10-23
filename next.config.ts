import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 启用 standalone 输出模式，用于 Docker 部署
  output: 'standalone',
  
  // 优化构建
  experimental: {
    // 启用 Turbopack（如果可用）
    turbo: {
      rules: {
        '*.svg': {
          loaders: ['@svgr/webpack'],
          as: '*.js',
        },
      },
    },
  },
  
  // 图片优化
  images: {
    unoptimized: true, // 在 Docker 环境中禁用图片优化
  },
};

export default nextConfig;
