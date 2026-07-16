# next-blog

## 附件中心

访问 `/attachments` 可以上传、下载并预览常见图片格式。页面和接口复用
`APK_DOWNLOAD_ACCESS_KEY`，页面验证成功后会将密钥保存在浏览器本地存储中。

接口上传示例（字段名支持 `file` 或 `files`）：

```bash
curl -X POST https://yoursigh.top/api/attachments \
  -H "Authorization: Bearer $APK_DOWNLOAD_ACCESS_KEY" \
  -F "file=@./example.pdf"
```

也可以使用 `X-Access-Key` 请求头。附件默认保存在 `/app/attachments`，通过
`ATTACHMENTS_DIR`、`ATTACHMENT_MAX_SIZE_MB` 和
`ATTACHMENT_MAX_REQUEST_SIZE_MB` 调整目录、单文件及单次请求大小限制。

## Countdown 发布控制台

控制台地址为 `/ops/countdown`，不会出现在博客菜单中。它负责登录、触发 GitHub Actions、
显示构建状态和提供受保护的 APK 下载；Next 容器不会获得 Docker Socket 或 SSH 私钥。
GitHub Actions 不再 SSH 登录服务器：镜像构建完成后只通过 HTTPS webhook 通知 Next，
Next 写入部署任务文件，再由服务器本地的 `countdown-deploy-agent` 拉镜像、重启容器并
健康检查/回滚。

独立安装包页面为 `/countdown/download`，同样不出现在博客菜单中。共享口令通过服务器
环境变量 `APK_DOWNLOAD_ACCESS_KEY` 配置，验证成功后签发 7 天有效的 HttpOnly Cookie；
失败次数会按 IP 持久化限流。页面仅返回服务器 APK、commit 和更新说明，不暴露 GitHub 地址。
APK 由 GitHub Actions 通过 HTTPS webhook 上传到 Next，再保存到 `COUNTDOWN_RELEASES_DIR`，
不会走 SSH/scp。
App 可通过公开的 `/api/apk/latest` 读取最新版本号与更新说明；该接口不返回 APK 文件地址，
正式版 App 通过 `/api/apk/mobile-download` 换取 10 分钟有效的临时下载地址；
下载地址交给 Android 系统下载管理器，不会把共享口令写入 APK。
新版 App 会复用已经激活设备的短期登录 Token，不再要求重复输入下载口令；旧版 App 的
口令请求暂时保留兼容。
网页端下载仍需在独立下载页验证共享口令。
验证后的网页同样使用短时签名直链，避免 Android 系统下载器因无法继承 HttpOnly Cookie
而出现 `0 B/s`。

### 1. 复用 Countdown MySQL

不需要新建数据库或账号。把 countdown 服务器部署目录 `.env` 中已有的 `MYSQL_USER`、
`MYSQL_PASSWORD` 和 `MYSQL_DATABASE` 填入 next-blog 的 `COUNTDOWN_DATABASE_URL`：

```dotenv
COUNTDOWN_DATABASE_URL=mysql://已有用户名:已有密码@countdown-mysql:3306/countdown
```

两个容器已经加入同一个 `blog-network`，因此数据库主机名使用 `countdown-mysql`。控制台
首次访问时会在 countdown 数据库中自动创建 `OpsLoginThrottle` 和 `OpsSession` 两张表，
不会修改 countdown 现有业务表。

### 2. 配置服务器环境变量

复制 `.env.example` 中的变量到服务器 next-blog 部署目录的 `.env`。生成登录密码哈希和
会话密钥：

```bash
npm install
npm run ops:hash-password -- '至少 12 位的强密码'
openssl rand -base64 48
mkdir -p /docker/countdown/releases
mkdir -p /docker/countdown/deploy-queue
mkdir -p /docker/countdown/backup-queue
```

Argon2 哈希含 `$`，写入 Compose `.env` 时要使用单引号包住整个哈希。
`APK_DOWNLOAD_ACCESS_KEY` 只写入服务器 `.env`，不要提交真实口令。
`DEPLOY_WEBHOOK_SECRET` 用于 GitHub Actions 调用服务器 webhook，建议同样用
`openssl rand -base64 48` 生成，并同时配置到：

- next-blog 服务器 `.env`
- countdown 仓库 GitHub Actions Secret `DEPLOY_WEBHOOK_SECRET`

Next 容器内用户 UID/GID 是 `1001`。如果手动创建目录，需要允许它写入：

```bash
chown -R 1001:1001 \
  /docker/countdown/releases \
  /docker/countdown/deploy-queue \
  /docker/countdown/backup-queue
```

`OPS_GITHUB_TOKEN` 使用 fine-grained PAT，只授权 `countdown` 仓库：

- Actions：Read and write
- Contents：Read-only

### 3. 配置 countdown 仓库 Actions Secrets

后端部署和 Android 构建工作流需要：

- `ALIYUN_REGISTRY_USERNAME`、`ALIYUN_REGISTRY_PASSWORD`
- `DEPLOY_WEBHOOK_SECRET`：必须与 next-blog 服务器 `.env` 中的值一致
- `EXPO_TOKEN`：只供 `eas build --local` 验证 Expo 项目身份；APK 不在 EAS 云端编译
- `ANDROID_CREDENTIALS_JSON`：本地 `credentials.json` 的完整内容
- `ANDROID_KEYSTORE_BASE64`：执行 `base64 < credentials/android/keystore.jks | tr -d '\n'` 得到

旧的 SSH 部署 Secrets 不再使用，可以在新流程验证成功后删除：

```text
DEPLOY_HOST
DEPLOY_PORT
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_SSH_KNOWN_HOSTS
COUNTDOWN_DEPLOY_PATH
COUNTDOWN_HEALTHCHECK_URL
COUNTDOWN_RELEASES_PATH
```

### 4. 安装服务器本地部署 Agent

把本仓库的 `scripts/countdown-deploy-agent.sh` 和
`scripts/install-countdown-deploy-agent.sh` 放到服务器 next-blog 部署目录后执行：

```bash
sudo RELEASES_DIR=/docker/countdown/releases \
  QUEUE_DIR=/docker/countdown/deploy-queue \
  DEPLOY_PATH=/docker/countdown \
  ./scripts/install-countdown-deploy-agent.sh
```

Agent 会安装一个 systemd timer，每 20 秒检查一次部署任务。它只在服务器本机执行
`docker compose pull/up`，不需要 GitHub 连接 SSH。

### 5. 安装即时备份 Agent

发布控制台可以即时生成数据库备份，或生成包含数据库、聊天图片、时间线图片和语音的
完整备份包。备份文件只为当前下载临时生成：下载流关闭后由 Next 删除，异常遗留文件
也会在两小时后由 Agent 清理。

把本仓库的 `scripts/countdown-backup-agent.sh` 和
`scripts/install-countdown-backup-agent.sh` 放到服务器 next-blog 部署目录后执行：

```bash
sudo BACKUP_QUEUE_DIR=/docker/countdown/backup-queue \
  API_SERVICE_NAME=countdown-api \
  MYSQL_SERVICE_NAME=countdown-mysql \
  ./scripts/install-countdown-backup-agent.sh
```

Agent 每 5 秒检查一次任务队列。数据库备份通过 MySQL 容器内的 `mysqldump` 在线导出；
完整备份会短暂暂停 Countdown API，创建不可变附件快照后立即恢复 API，再在后台压缩。
网页容器仍然没有 Docker Socket，也不会拿到宿主机执行权限。

备份队列需要同时挂载给 next-blog 容器，因此服务器 `.env` 还需要：

```dotenv
COUNTDOWN_BACKUP_QUEUE_DIR=/docker/countdown/backup-queue
```

### 6. 发布

先把 countdown 的工作流和 Compose 更新部署到对应仓库/服务器，再重新构建 next-blog：

```bash
make build
docker compose pull next-blog
docker compose up -d
```

生产 Compose 不再向宿主机公开 Next 的 3000 端口；Nginx 通过 `blog-network` 访问它。
