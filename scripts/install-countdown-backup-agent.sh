#!/usr/bin/env bash
set -euo pipefail

BACKUP_QUEUE_DIR="${BACKUP_QUEUE_DIR:-/docker/countdown/backup-queue}"
API_SERVICE_NAME="${API_SERVICE_NAME:-countdown-api}"
MYSQL_SERVICE_NAME="${MYSQL_SERVICE_NAME:-countdown-mysql}"
NEXT_CONTAINER_UID="${NEXT_CONTAINER_UID:-1001}"
NEXT_CONTAINER_GID="${NEXT_CONTAINER_GID:-1001}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "请用 root 执行：sudo $0" >&2
  exit 1
fi

install -m 0755 "$(dirname "$0")/countdown-backup-agent.sh" \
  /usr/local/bin/countdown-backup-agent

mkdir -p \
  "$BACKUP_QUEUE_DIR/pending" \
  "$BACKUP_QUEUE_DIR/processing" \
  "$BACKUP_QUEUE_DIR/done" \
  "$BACKUP_QUEUE_DIR/failed" \
  "$BACKUP_QUEUE_DIR/artifacts" \
  "$BACKUP_QUEUE_DIR/logs"
chown -R "${NEXT_CONTAINER_UID}:${NEXT_CONTAINER_GID}" "$BACKUP_QUEUE_DIR"
chmod 700 "$BACKUP_QUEUE_DIR" "$BACKUP_QUEUE_DIR"/*

cat >/etc/systemd/system/countdown-backup-agent.service <<SERVICE
[Unit]
Description=Countdown on-demand backup agent
Wants=docker.service
After=docker.service

[Service]
Type=oneshot
Environment=BACKUP_QUEUE_DIR=${BACKUP_QUEUE_DIR}
Environment=API_SERVICE_NAME=${API_SERVICE_NAME}
Environment=MYSQL_SERVICE_NAME=${MYSQL_SERVICE_NAME}
Environment=NEXT_CONTAINER_UID=${NEXT_CONTAINER_UID}
Environment=NEXT_CONTAINER_GID=${NEXT_CONTAINER_GID}
ExecStart=/usr/local/bin/countdown-backup-agent
SERVICE

cat >/etc/systemd/system/countdown-backup-agent.timer <<'TIMER'
[Unit]
Description=Check Countdown on-demand backup queue

[Timer]
OnBootSec=5s
OnUnitActiveSec=5s
AccuracySec=1s
Persistent=true

[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now countdown-backup-agent.timer
systemctl start countdown-backup-agent.service || true

echo "已安装 Countdown 即时备份 Agent。状态："
systemctl --no-pager status countdown-backup-agent.timer || true
