# ====== 公共参数（可按需覆盖）======
ARG REGISTRY=crpi-lgty92ojoeq0mwd1.cn-hangzhou.personal.cr.aliyuncs.com
ARG NAMESPACE=next-blog
ARG NODE_TAG_BASE=20-slim
ARG TARGETARCH

# ========= 第一阶段：构建 =========
FROM ${REGISTRY}/${NAMESPACE}/node:${NODE_TAG_BASE}-${TARGETARCH} AS builder

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖（包括开发依赖，因为构建需要）
RUN npm ci

# 复制源代码
COPY . .

# 构建应用
RUN npm run build

# ========= 第二阶段：运行 =========
FROM ${REGISTRY}/${NAMESPACE}/node:${NODE_TAG_BASE}-${TARGETARCH} AS runner

# 设置工作目录
WORKDIR /app

# 创建非 root 用户
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# 复制构建产物
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 运行时环境
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# 更安全的权限
RUN chown -R nextjs:nodejs /app
USER nextjs

# 暴露端口
EXPOSE 3000

# 启动应用（Next standalone 的入口为 ./server.js）
CMD ["node", "server.js"]
