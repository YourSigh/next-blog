# next-blog

## Countdown 发布控制台

控制台地址为 `/ops/countdown`，不会出现在博客菜单中。它负责登录、触发 GitHub Actions、
显示构建状态和提供受保护的 APK 下载；Next 容器不会获得 Docker Socket 或 SSH 私钥。

独立安装包页面为 `/countdown/download`，同样不出现在博客菜单中。共享口令通过服务器
环境变量 `APK_DOWNLOAD_ACCESS_KEY` 配置，验证成功后签发 7 天有效的 HttpOnly Cookie；
失败次数会按 IP 持久化限流。页面仅返回服务器 APK、commit 和更新说明，不暴露 GitHub 地址。
App 可通过公开的 `/api/apk/latest` 读取最新版本号与更新说明；该接口不返回 APK 文件地址，
正式版 App 输入下载口令后，可通过 `/api/apk/mobile-download` 换取 10 分钟有效的临时下载地址；
下载地址交给 Android 系统下载管理器，不会把共享口令写入 APK。
网页端下载仍需在独立下载页验证共享口令。

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
mkdir -p /opt/countdown/releases
```

Argon2 哈希含 `$`，写入 Compose `.env` 时要使用单引号包住整个哈希。
`APK_DOWNLOAD_ACCESS_KEY` 只写入服务器 `.env`，不要提交真实口令。

`OPS_GITHUB_TOKEN` 使用 fine-grained PAT，只授权 `countdown` 仓库：

- Actions：Read and write
- Contents：Read-only

### 3. 配置 countdown 仓库 Actions Secrets

后端部署和 Android 构建工作流需要：

- `ALIYUN_REGISTRY_USERNAME`、`ALIYUN_REGISTRY_PASSWORD`
- `DEPLOY_HOST`、`DEPLOY_PORT`、`DEPLOY_USER`
- `DEPLOY_SSH_KEY`、`DEPLOY_SSH_KNOWN_HOSTS`
- `COUNTDOWN_DEPLOY_PATH`：服务器上 countdown 的 Compose 目录
- `COUNTDOWN_HEALTHCHECK_URL`：例如 `https://yoursigh.top/api/countdown/health`
- `COUNTDOWN_RELEASES_PATH`：建议 `/opt/countdown/releases`
- `EXPO_TOKEN`：只供 `eas build --local` 验证 Expo 项目身份；APK 不在 EAS 云端编译
- `ANDROID_CREDENTIALS_JSON`：本地 `credentials.json` 的完整内容
- `ANDROID_KEYSTORE_BASE64`：执行 `base64 < credentials/android/keystore.jks | tr -d '\n'` 得到

`DEPLOY_SSH_KNOWN_HOSTS` 应从可信网络执行 `ssh-keyscan -H 服务器地址` 后保存，不要在工作流
运行时临时信任主机。

### 4. 发布

先把 countdown 的工作流和 Compose 更新部署到对应仓库/服务器，再重新构建 next-blog：

```bash
make build
docker compose pull next-blog
docker compose up -d
```

生产 Compose 不再向宿主机公开 Next 的 3000 端口；Nginx 通过 `blog-network` 访问它。
