#!/usr/bin/env bash
set -euo pipefail

QUEUE_DIR="${QUEUE_DIR:-/docker/countdown/deploy-queue}"
RELEASES_DIR="${RELEASES_DIR:-/docker/countdown/releases}"
DEPLOY_PATH="${DEPLOY_PATH:-/docker/countdown}"
NEXT_CONTAINER_UID="${NEXT_CONTAINER_UID:-1001}"
NEXT_CONTAINER_GID="${NEXT_CONTAINER_GID:-1001}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "请用 root 执行：sudo $0" >&2
  exit 1
fi

install -m 0755 "$(dirname "$0")/countdown-deploy-agent.sh" \
  /usr/local/bin/countdown-deploy-agent

mkdir -p \
  "$QUEUE_DIR/pending" \
  "$QUEUE_DIR/processing" \
  "$QUEUE_DIR/done" \
  "$QUEUE_DIR/failed" \
  "$QUEUE_DIR/logs" \
  "$RELEASES_DIR"

# Next 容器内用户 UID/GID 是 1001，需要能写队列 pending 和 APK releases 目录。
chown -R "${NEXT_CONTAINER_UID}:${NEXT_CONTAINER_GID}" "$QUEUE_DIR" "$RELEASES_DIR"
chmod -R u+rwX,go+rX "$QUEUE_DIR" "$RELEASES_DIR"

cat >/etc/systemd/system/countdown-deploy-agent.service <<SERVICE
[Unit]
Description=Countdown API deploy agent
Wants=docker.service
After=docker.service

[Service]
Type=oneshot
Environment=QUEUE_DIR=${QUEUE_DIR}
Environment=DEPLOY_PATH=${DEPLOY_PATH}
ExecStart=/usr/local/bin/countdown-deploy-agent
SERVICE

cat >/etc/systemd/system/countdown-deploy-agent.timer <<'TIMER'
[Unit]
Description=Run Countdown API deploy agent frequently

[Timer]
OnBootSec=20s
OnUnitActiveSec=20s
AccuracySec=5s
Persistent=true

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now countdown-deploy-agent.timer
systemctl start countdown-deploy-agent.service || true

echo "已安装 countdown-deploy-agent。状态："
systemctl --no-pager status countdown-deploy-agent.timer || true
