#!/usr/bin/env bash
set -Eeuo pipefail

QUEUE_DIR="${BACKUP_QUEUE_DIR:-/docker/countdown/backup-queue}"
API_SERVICE_NAME="${API_SERVICE_NAME:-countdown-api}"
MYSQL_SERVICE_NAME="${MYSQL_SERVICE_NAME:-countdown-mysql}"
NEXT_CONTAINER_UID="${NEXT_CONTAINER_UID:-1001}"
NEXT_CONTAINER_GID="${NEXT_CONTAINER_GID:-1001}"

mkdir -p \
  "$QUEUE_DIR/pending" \
  "$QUEUE_DIR/processing" \
  "$QUEUE_DIR/done" \
  "$QUEUE_DIR/failed" \
  "$QUEUE_DIR/artifacts" \
  "$QUEUE_DIR/logs"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
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

write_result() {
  local task_file="$1"
  local status="$2"
  local artifact_file_name="${3:-}"
  local artifact_size="${4:-}"
  local stats_file="${5:-}"
  local error_message="${6:-}"

  python3 - \
    "$task_file" \
    "$status" \
    "$artifact_file_name" \
    "$artifact_size" \
    "$stats_file" \
    "$error_message" <<'PY'
import json
import os
import sys
from datetime import datetime, timezone

task_path, status, artifact_name, artifact_size, stats_path, error = sys.argv[1:]
with open(task_path, encoding="utf-8") as handle:
    task = json.load(handle)

task["status"] = status
task["completedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
if artifact_name:
    task["artifactFileName"] = artifact_name
if artifact_size:
    task["artifactSize"] = int(artifact_size)
if stats_path:
    with open(stats_path, encoding="utf-8") as handle:
        task["mediaStats"] = json.load(handle)
if error:
    task["error"] = error

temporary = f"{task_path}.tmp-{os.getpid()}"
with open(temporary, "w", encoding="utf-8") as handle:
    json.dump(task, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
os.replace(temporary, task_path)
PY
}

api_image() {
  docker inspect --format '{{.Image}}' "$API_SERVICE_NAME"
}

create_database_dump() {
  local output_file="$1"
  if ! docker exec "$MYSQL_SERVICE_NAME" sh -ec '
      export MYSQL_PWD="$MYSQL_PASSWORD"
      exec mysqldump \
        --user="$MYSQL_USER" \
        --host=127.0.0.1 \
        --single-transaction \
        --quick \
        --routines \
        --events \
        --triggers \
        --hex-blob \
        --set-gtid-purged=OFF \
        --no-tablespaces \
        --default-character-set=utf8mb4 \
        "$MYSQL_DATABASE"
    ' | gzip -c > "$output_file"; then
    rm -f "$output_file"
    return 1
  fi

  test -s "$output_file"
  gzip -t "$output_file"
  if (( $(wc -c < "$output_file") <= 20 )); then
    log "数据库导出内容为空"
    rm -f "$output_file"
    return 1
  fi
}

file_size() {
  wc -c < "$1" | tr -d '[:space:]'
}

collect_media_stats() {
  local output_file="$1"
  local media_root="${2:-/app/uploads}"
  local image
  image="$(api_image)"

  docker run --rm -i \
    --volumes-from "$API_SERVICE_NAME" \
    --entrypoint node \
    "$image" - "$media_root" > "$output_file" <<'NODE'
const fs = require("node:fs/promises");
const path = require("node:path");

const root = process.argv[2];
const now = Date.now();
const DAY = 24 * 60 * 60 * 1000;
const categories = {
  voice: { bytes: 0, files: 0 },
  chatImages: { bytes: 0, files: 0 },
  timelineImages: { bytes: 0, files: 0 },
  other: { bytes: 0, files: 0 },
};
let totalBytes = 0;
let totalFiles = 0;
let firstTime = null;
let lastTime = null;
let recent7DayBytes = 0;

function categoryFor(relativePath) {
  const top = relativePath.split(path.sep)[0];
  if (top === "chat-audio") return "voice";
  if (top === "chat-images") return "chatImages";
  if (top === "timeline-images") return "timelineImages";
  return "other";
}

async function walk(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".ops-backup-")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolute);
      continue;
    }
    if (!entry.isFile()) continue;

    const info = await fs.stat(absolute);
    const key = categoryFor(path.relative(root, absolute));
    categories[key].bytes += info.size;
    categories[key].files += 1;
    totalBytes += info.size;
    totalFiles += 1;
    firstTime = firstTime === null ? info.mtimeMs : Math.min(firstTime, info.mtimeMs);
    lastTime = lastTime === null ? info.mtimeMs : Math.max(lastTime, info.mtimeMs);
    if (info.mtimeMs >= now - 7 * DAY) recent7DayBytes += info.size;
  }
}

(async () => {
  await walk(root);
  const observedDays = firstTime === null ? 0 : Math.max(1, Math.ceil((now - firstTime) / DAY));
  const recentObservedDays = Math.max(1, Math.min(7, observedDays || 1));
  process.stdout.write(JSON.stringify({
    measuredAt: new Date(now).toISOString(),
    firstFileAt: firstTime === null ? null : new Date(firstTime).toISOString(),
    lastFileAt: lastTime === null ? null : new Date(lastTime).toISOString(),
    observedDays,
    totalBytes,
    totalFiles,
    averageBytesPerDay: observedDays ? Math.round(totalBytes / observedDays) : 0,
    recent7DayBytes,
    recent7DayAverageBytes: Math.round(recent7DayBytes / recentObservedDays),
    categories,
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
}

make_complete_backup() (
  local task_id="$1"
  local artifact_file="$2"
  local stats_file="$3"
  local staging_dir="$4"
  local image
  local snapshot_name=".ops-backup-${task_id}"
  local api_paused=0
  local snapshot_created=0
  image="$(api_image)"

  cleanup_complete_backup() {
    if (( api_paused == 1 )); then
      docker unpause "$API_SERVICE_NAME" >/dev/null 2>&1 || true
    fi
    if (( snapshot_created == 1 )); then
      docker run --rm \
        --volumes-from "$API_SERVICE_NAME" \
        --entrypoint sh \
        "$image" -ec 'rm -rf -- "/app/uploads/$1"' sh "$snapshot_name" \
        >/dev/null 2>&1 || true
    fi
  }
  trap cleanup_complete_backup EXIT

  mkdir -p "$staging_dir"
  chown "$NEXT_CONTAINER_UID:$NEXT_CONTAINER_GID" "$staging_dir"

  log "短暂暂停 API 写入并建立一致的附件快照"
  docker pause "$API_SERVICE_NAME" >/dev/null
  api_paused=1

  create_database_dump "$staging_dir/database.sql.gz"

  docker run --rm \
    --volumes-from "$API_SERVICE_NAME" \
    --entrypoint sh \
    "$image" -ec '
      snapshot="/app/uploads/$1"
      mkdir -p "$snapshot"
      for directory in chat-audio chat-images timeline-images; do
        if [ -d "/app/uploads/$directory" ]; then
          cp -al "/app/uploads/$directory" "$snapshot/$directory"
        fi
      done
    ' sh "$snapshot_name"
  snapshot_created=1

  docker unpause "$API_SERVICE_NAME" >/dev/null
  api_paused=0
  log "API 已恢复，开始在后台压缩附件"

  collect_media_stats "$stats_file" "/app/uploads/$snapshot_name"

  python3 - "$task_id" "$stats_file" "$staging_dir/manifest.json" <<'PY'
import json
import sys
from datetime import datetime, timezone

task_id, stats_path, output_path = sys.argv[1:]
with open(stats_path, encoding="utf-8") as handle:
    stats = json.load(handle)

manifest = {
    "formatVersion": 1,
    "product": "countdown",
    "kind": "complete",
    "taskId": task_id,
    "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "database": "database.sql.gz",
    "uploads": "uploads/",
    "mediaStats": stats,
    "restoreNote": "Restore database.sql.gz into MySQL, then copy the uploads directory into the API uploads volume.",
}
with open(output_path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY

  (
    cd "$staging_dir"
    sha256sum database.sql.gz > SHA256SUMS
  )
  ln -s "/app/uploads/$snapshot_name" "$staging_dir/uploads"
  docker run --rm \
    --volumes-from "$API_SERVICE_NAME" \
    -v "$staging_dir:/backup:ro" \
    -v "$(dirname "$artifact_file"):/output" \
    --entrypoint tar \
    "$image" -chzf "/output/$(basename "$artifact_file")" \
      -C /backup database.sql.gz manifest.json SHA256SUMS uploads
  test -s "$artifact_file"

  docker run --rm \
    --volumes-from "$API_SERVICE_NAME" \
    --entrypoint sh \
    "$image" -ec 'rm -rf -- "/app/uploads/$1"' sh "$snapshot_name"
  snapshot_created=0
)

process_task() {
  local task_file="$1"
  local task_name
  local task_id
  local kind
  local processing_file
  local done_file
  local failed_file
  local log_file
  local result
  task_name="$(basename "$task_file")"
  task_id="${task_name%.json}"

  if [[ ! "$task_id" =~ ^backup-[0-9]{13}-[a-f0-9-]{36}$ ]]; then
    log "忽略无效任务文件：$task_name"
    return 0
  fi

  processing_file="$QUEUE_DIR/processing/$task_name"
  done_file="$QUEUE_DIR/done/$task_name"
  failed_file="$QUEUE_DIR/failed/$task_name"
  log_file="$QUEUE_DIR/logs/${task_id}.log"
  mv "$task_file" "$processing_file" || return 0

  set +e
  (
    set -Eeuo pipefail
    kind="$(json_field "$processing_file" kind)"
    log "开始处理备份任务：${task_id}（${kind}）"

    case "$kind" in
      stats)
        stats_file="$QUEUE_DIR/artifacts/.${task_id}-stats.json"
        collect_media_stats "$stats_file"
        write_result "$processing_file" "done" "" "" "$stats_file"
        rm -f "$stats_file"
        ;;
      database)
        timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
        suffix="${task_id: -8}"
        artifact_name="countdown-database-${timestamp}-${suffix}.sql.gz"
        artifact_file="$QUEUE_DIR/artifacts/$artifact_name"
        temporary_file="$QUEUE_DIR/artifacts/.${artifact_name}.tmp"
        create_database_dump "$temporary_file"
        mv "$temporary_file" "$artifact_file"
        chown "$NEXT_CONTAINER_UID:$NEXT_CONTAINER_GID" "$artifact_file"
        chmod 600 "$artifact_file"
        artifact_size="$(file_size "$artifact_file")"
        write_result "$processing_file" "done" "$artifact_name" "$artifact_size"
        ;;
      complete)
        timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
        suffix="${task_id: -8}"
        artifact_name="countdown-complete-${timestamp}-${suffix}.tar.gz"
        artifact_file="$QUEUE_DIR/artifacts/$artifact_name"
        temporary_file="$QUEUE_DIR/artifacts/.${artifact_name}.tmp"
        staging_dir="$QUEUE_DIR/artifacts/.${task_id}-staging"
        stats_file="$staging_dir/media-stats.json"
        rm -rf "$staging_dir" "$temporary_file"
        make_complete_backup "$task_id" "$temporary_file" "$stats_file" "$staging_dir"
        mv "$temporary_file" "$artifact_file"
        chown "$NEXT_CONTAINER_UID:$NEXT_CONTAINER_GID" "$artifact_file"
        chmod 600 "$artifact_file"
        artifact_size="$(file_size "$artifact_file")"
        write_result "$processing_file" "done" "$artifact_name" "$artifact_size" "$stats_file"
        rm -rf "$staging_dir"
        ;;
      *)
        log "不支持的备份类型：$kind"
        exit 2
        ;;
    esac

    mv "$processing_file" "$done_file"
    log "备份任务完成：$task_id"
  ) > >(tee -a "$log_file") 2>&1
  result=$?
  set -e

  if (( result == 0 )); then
    return 0
  fi

  log "备份任务失败：$task_id"
  if [[ -f "$processing_file" ]]; then
    write_result \
      "$processing_file" \
      "failed" \
      "" \
      "" \
      "" \
      "备份生成失败，请检查服务器 Agent 日志"
    mv "$processing_file" "$failed_file"
  fi
  return 0
}

# 即时备份文件只用于本次下载；异常中断遗留的文件两小时后自动清理。
find "$QUEUE_DIR/artifacts" -maxdepth 1 -type f -mmin +120 -delete 2>/dev/null || true
find "$QUEUE_DIR/artifacts" -maxdepth 1 -type d -name '.backup-*-staging' -mmin +120 -exec rm -rf {} + 2>/dev/null || true
find "$QUEUE_DIR/done" "$QUEUE_DIR/failed" "$QUEUE_DIR/logs" \
  -maxdepth 1 -type f -mtime +7 -delete 2>/dev/null || true

shopt -s nullglob
tasks=("$QUEUE_DIR"/pending/*.json)
for task in "${tasks[@]}"; do
  process_task "$task"
done
