#!/usr/bin/env bash
set -euo pipefail

QUEUE_DIR="${QUEUE_DIR:-/docker/countdown/deploy-queue}"
DEPLOY_PATH="${DEPLOY_PATH:-/docker/countdown}"
SERVICE_NAME="${SERVICE_NAME:-countdown-api}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-30}"
ROLLBACK_HEALTH_ATTEMPTS="${ROLLBACK_HEALTH_ATTEMPTS:-15}"

mkdir -p \
  "$QUEUE_DIR/pending" \
  "$QUEUE_DIR/processing" \
  "$QUEUE_DIR/done" \
  "$QUEUE_DIR/failed" \
  "$QUEUE_DIR/logs"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*"
}

reload_nginx() {
  local nginx_container
  nginx_container="$(docker ps \
    --filter label=com.docker.compose.service=nginx \
    --format '{{.ID}}' | head -n 1)"
  if [[ -n "$nginx_container" ]]; then
    docker kill --signal=HUP "$nginx_container" >/dev/null
  else
    log "警告：未找到 Nginx 容器，跳过 DNS 重载"
  fi
}

check_health() {
  local attempts="$1"
  local attempt
  for attempt in $(seq 1 "$attempts"); do
    if docker exec "$SERVICE_NAME" node -e "
      fetch('http://127.0.0.1:4000/health')
        .then((response) => process.exit(response.ok ? 0 : 1))
        .catch(() => process.exit(1));
    " >/dev/null 2>&1; then
      return 0
    fi
    sleep 4
  done
  return 1
}

show_diagnostics() {
  log "${SERVICE_NAME} 容器状态："
  docker ps -a --filter name="$SERVICE_NAME" \
    --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' || true
  log "${SERVICE_NAME} 最近日志："
  docker logs --tail 160 "$SERVICE_NAME" 2>&1 || true
}

json_field() {
  local file="$1"
  local field="$2"
  python3 - "$file" "$field" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    data = json.load(handle)

value = data.get(sys.argv[2], "")
print("" if value is None else value)
PY
}

deploy_task() {
  local task_file="$1"
  local task_name
  local processing_file
  local done_file
  local failed_file
  local log_file
  task_name="$(basename "$task_file")"
  processing_file="$QUEUE_DIR/processing/$task_name"
  done_file="$QUEUE_DIR/done/$task_name"
  failed_file="$QUEUE_DIR/failed/$task_name"
  log_file="$QUEUE_DIR/logs/${task_name%.json}.log"

  mv "$task_file" "$processing_file" || return 0

  {
    log "开始处理部署任务：$task_name"
    local new_image
    local old_image
    new_image="$(json_field "$processing_file" image)"
    if [[ ! "$new_image" =~ ^crpi-lgty92ojoeq0mwd1\.cn-hangzhou\.personal\.cr\.aliyuncs\.com/next-blog/countdown-api:[a-f0-9]{40}$ ]]; then
      log "镜像地址无效：$new_image"
      mv "$processing_file" "$failed_file"
      return 1
    fi

    cd "$DEPLOY_PATH"
    old_image="$(docker inspect --format '{{.Config.Image}}' "$SERVICE_NAME" 2>/dev/null || true)"

    log "拉取并重建 ${SERVICE_NAME}：$new_image"
    export COUNTDOWN_API_IMAGE="$new_image"
    docker compose pull "$SERVICE_NAME"
    docker compose up -d --no-deps --force-recreate "$SERVICE_NAME"
    reload_nginx

    if check_health "$HEALTH_ATTEMPTS"; then
      log "新版本健康检查通过"
      mv "$processing_file" "$done_file"
      return 0
    fi

    log "新版本健康检查失败，开始回滚"
    show_diagnostics
    if [[ -n "$old_image" ]]; then
      export COUNTDOWN_API_IMAGE="$old_image"
      docker compose up -d --no-deps --force-recreate "$SERVICE_NAME"
      reload_nginx
      if check_health "$ROLLBACK_HEALTH_ATTEMPTS"; then
        log "旧版本已恢复健康，本次部署标记为失败"
      else
        log "回滚后健康检查仍失败，需要人工处理"
        show_diagnostics
      fi
    else
      log "没有可用旧镜像，无法回滚"
    fi

    mv "$processing_file" "$failed_file"
    return 1
  } > >(tee -a "$log_file") 2>&1
}

shopt -s nullglob
tasks=("$QUEUE_DIR"/pending/*.json)
if (( ${#tasks[@]} == 0 )); then
  exit 0
fi

for task in "${tasks[@]}"; do
  deploy_task "$task" || true
done
