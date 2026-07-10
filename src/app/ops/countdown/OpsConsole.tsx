"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import styles from "./ops.module.css";

type WorkflowRun = {
  id: number;
  title: string;
  status: string;
  conclusion: string | null;
  url: string;
  branch: string;
  commit: string;
  actor: string;
  createdAt: string;
};

type Release = {
  filename: string;
  size: number;
  modifiedAt: string;
  commit?: string;
  runUrl?: string;
};

type BackupKind = "database" | "complete";
type MediaCategoryStats = { bytes: number; files: number };
type MediaStats = {
  measuredAt: string;
  firstFileAt: string | null;
  lastFileAt: string | null;
  observedDays: number;
  totalBytes: number;
  totalFiles: number;
  averageBytesPerDay: number;
  recent7DayBytes: number;
  recent7DayAverageBytes: number;
  categories: {
    voice: MediaCategoryStats;
    chatImages: MediaCategoryStats;
    timelineImages: MediaCategoryStats;
    other: MediaCategoryStats;
  };
};
type BackupTask = {
  id: string;
  kind: BackupKind | "stats";
  state: "pending" | "processing" | "done" | "failed";
  artifactFileName?: string;
  artifactSize?: number;
  mediaStats?: MediaStats;
  error?: string;
};

type Dashboard = {
  username: string;
  health: { ok: boolean; status: number | null; error?: string };
  releases: Release[];
  workflows: {
    deployApi: WorkflowRun[];
    buildAndroid: WorkflowRun[];
  };
};

type AuthState = "loading" | "anonymous" | "authenticated";
type DispatchAction = "deploy-api" | "build-android";
type PendingDialog =
  | { kind: "dispatch"; action: DispatchAction }
  | { kind: "cancel-run"; action: DispatchAction; run: WorkflowRun }
  | { kind: "backup"; backup: BackupKind };

const MEDIA_BUDGET_BYTES = 5 * 1024 * 1024 * 1024;

const actionCopy: Record<DispatchAction, { eyebrow: string; title: string; description: string; confirm: string }> = {
  "deploy-api": {
    eyebrow: "DEPLOY API",
    title: "构建并部署后端？",
    description: "将使用 main 分支的最新提交构建镜像、重启线上容器，并执行健康检查。",
    confirm: "确认部署",
  },
  "build-android": {
    eyebrow: "BUILD ANDROID",
    title: "开始构建 Android APK？",
    description: "将使用 main 分支的最新提交启动云端构建，完成后自动发布到下载页。",
    confirm: "开始构建",
  },
};

function ConfirmDialog({
  dialog,
  onCancel,
  onConfirm,
}: {
  dialog: PendingDialog;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const isCancelRun = dialog.kind === "cancel-run";
  const isBackup = dialog.kind === "backup";
  const copy = isCancelRun
    ? {
        eyebrow: "CANCEL ACTION",
        title: "取消这次 GitHub Action？",
        description: `将请求 GitHub 停止「${dialog.run.title || "这条运行记录"}」。如果任务已经结束，GitHub 会返回不可取消。`,
        confirm: "确认取消",
        icon: "STOP",
        metaLabel: "Run",
        metaValue: dialog.run.commit,
      }
    : isBackup
      ? dialog.backup === "database"
        ? {
            eyebrow: "DATABASE BACKUP",
            title: "生成并下载数据库备份？",
            description: "服务器会在线生成一致的压缩 SQL 文件，浏览器开始下载后立即删除临时文件。",
            confirm: "生成并下载",
            icon: "DB",
            metaLabel: "包含内容",
            metaValue: "全部数据库表",
          }
        : {
            eyebrow: "COMPLETE BACKUP",
            title: "生成完整备份包？",
            description: "将短暂暂停 API 写入以建立一致快照，再打包数据库、聊天图片、时间线图片和语音。文件较多时需要等待几分钟。",
            confirm: "生成完整备份",
            icon: "ALL",
            metaLabel: "服务器保留",
            metaValue: "下载后立即删除",
          }
      : {
        ...actionCopy[dialog.action],
        icon: dialog.action === "deploy-api" ? "API" : "APK",
        metaLabel: "来源分支",
        metaValue: "main",
      };

  useEffect(() => {
    cancelButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-dialog-title"
        aria-describedby="dispatch-dialog-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.dialogIcon} aria-hidden="true">
          {copy.icon}
        </div>
        <p className={styles.dialogEyebrow}>{copy.eyebrow}</p>
        <h2 id="dispatch-dialog-title">{copy.title}</h2>
        <p id="dispatch-dialog-description">{copy.description}</p>
        <div className={styles.dialogBranch}>
          <span className={styles.branchDot} />
          {copy.metaLabel} <strong>{copy.metaValue}</strong>
        </div>
        <div className={styles.dialogActions}>
          <button ref={cancelButtonRef} type="button" className={styles.dialogCancel} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={`${styles.dialogConfirm} ${isCancelRun ? styles.dialogConfirmDanger : ""}`}
            onClick={onConfirm}
          >
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`);
  return body;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function mediaForecast(stats: MediaStats): string {
  const sample = `已统计 ${stats.totalFiles} 个文件，覆盖约 ${stats.observedDays} 天。`;
  if (stats.averageBytesPerDay <= 0) {
    return `${sample}当前还没有足够数据估算增长速度。`;
  }
  if (stats.totalBytes >= MEDIA_BUDGET_BYTES) {
    return `${sample}附件已经达到预留的 5 GB 上限，建议尽快执行清理策略。`;
  }

  const days = Math.ceil(
    (MEDIA_BUDGET_BYTES - stats.totalBytes) / stats.averageBytesPerDay,
  );
  const date = new Date(Date.now() + days * 24 * 60 * 60_000);
  const dateLabel = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return `${sample}按历史日均增长，预计约 ${days} 天后（${dateLabel}）达到 5 GB。`;
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function runState(run: WorkflowRun): { label: string; tone: string } {
  if (run.status !== "completed") return { label: "进行中", tone: "running" };
  if (run.conclusion === "success") return { label: "成功", tone: "success" };
  if (run.conclusion === "cancelled") return { label: "已取消", tone: "muted" };
  return { label: "失败", tone: "danger" };
}

function cancelBusyKey(runId: number): string {
  return `cancel-run-${runId}`;
}

function RunList({
  action,
  busy,
  runs,
  onCancelRun,
}: {
  action: DispatchAction;
  busy: string | null;
  runs: WorkflowRun[];
  onCancelRun: (action: DispatchAction, run: WorkflowRun) => void;
}) {
  if (!runs.length) return <p className={styles.empty}>暂无运行记录</p>;

  return (
    <div className={styles.runList}>
      {runs.map((run) => {
        const state = runState(run);
        const canCancel = run.status !== "completed";
        const isCancelling = busy === cancelBusyKey(run.id);
        return (
          <div key={run.id} className={styles.runItem}>
            <a href={run.url} target="_blank" rel="noreferrer" className={styles.runLink}>
              <span className={`${styles.stateDot} ${styles[state.tone]}`} />
              <span className={styles.runBody}>
                <strong>{state.label}</strong>
                <small>{run.commit} · {run.actor} · {formatTime(run.createdAt)}</small>
              </span>
              <span className={styles.runLog} aria-hidden="true">GitHub 日志 ↗</span>
            </a>
            {canCancel && (
              <button
                type="button"
                className={styles.cancelRunButton}
                onClick={() => onCancelRun(action, run)}
                disabled={Boolean(busy)}
              >
                {isCancelling ? "取消中…" : "取消"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function OpsConsole() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const [mediaStats, setMediaStats] = useState<MediaStats | null>(null);
  const [mediaStatsError, setMediaStatsError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingDialog, setPendingDialog] = useState<PendingDialog | null>(null);
  const mediaStatsRequestedRef = useRef(false);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await jsonRequest<Dashboard>("/api/ops/dashboard");
      setDashboard(data);
      setAuthState("authenticated");
    } catch (error) {
      if (error instanceof Error && error.message === "未登录") {
        setAuthState("anonymous");
        setDashboard(null);
      } else {
        setMessage(error instanceof Error ? error.message : "加载失败");
      }
    }
  }, []);

  const waitForBackupTask = useCallback(async (id: string) => {
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
      const result = await jsonRequest<{ task: BackupTask }>(
        `/api/ops/backups?id=${encodeURIComponent(id)}`,
      );
      if (result.task.state === "done") return result.task;
      if (result.task.state === "failed") {
        throw new Error(result.task.error || "备份生成失败");
      }
      await wait(1_500);
    }
    throw new Error("备份生成超时，请检查服务器 Agent 状态");
  }, []);

  const loadMediaStats = useCallback(async () => {
    if (statsBusy) return;
    setStatsBusy(true);
    setMediaStatsError("");
    try {
      const result = await jsonRequest<{ task: BackupTask }>("/api/ops/backups", {
        method: "POST",
        body: JSON.stringify({ kind: "stats" }),
      });
      const task = await waitForBackupTask(result.task.id);
      if (!task.mediaStats) throw new Error("服务器没有返回媒体容量统计");
      setMediaStats(task.mediaStats);
    } catch (error) {
      setMediaStatsError(error instanceof Error ? error.message : "媒体容量统计失败");
    } finally {
      setStatsBusy(false);
    }
  }, [statsBusy, waitForBackupTask]);

  useEffect(() => {
    jsonRequest<{ authenticated: boolean }>("/api/ops/auth/status")
      .then((state) => {
        if (state.authenticated) return loadDashboard();
        setAuthState("anonymous");
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "登录服务不可用");
        setAuthState("anonymous");
      });
  }, [loadDashboard]);

  useEffect(() => {
    if (authState !== "authenticated") return;
    const timer = window.setInterval(loadDashboard, 10_000);
    return () => window.clearInterval(timer);
  }, [authState, loadDashboard]);

  useEffect(() => {
    if (authState === "authenticated" && !mediaStatsRequestedRef.current) {
      mediaStatsRequestedRef.current = true;
      void loadMediaStats();
    }
  }, [authState, loadMediaStats]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("login");
    setMessage("");
    try {
      await jsonRequest("/api/ops/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      setPassword("");
      await loadDashboard();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "登录失败");
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    setBusy("logout");
    try {
      await jsonRequest("/api/ops/auth/logout", { method: "POST", body: "{}" });
    } finally {
      setDashboard(null);
      setAuthState("anonymous");
      setBusy(null);
    }
  }

  async function dispatch(action: DispatchAction) {
    setPendingDialog(null);
    setBusy(action);
    setMessage("");
    try {
      await jsonRequest("/api/ops/dispatch", {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      setMessage("任务已提交，GitHub Actions 通常会在几秒内出现。");
      window.setTimeout(loadDashboard, 3_000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "任务提交失败");
    } finally {
      setBusy(null);
    }
  }

  async function cancelRun(action: DispatchAction, run: WorkflowRun) {
    setPendingDialog(null);
    setBusy(cancelBusyKey(run.id));
    setMessage("");
    try {
      await jsonRequest("/api/ops/cancel", {
        method: "POST",
        body: JSON.stringify({ action, runId: run.id }),
      });
      setMessage("已向 GitHub 发送取消请求，状态会在几秒内同步。");
      await loadDashboard();
      window.setTimeout(loadDashboard, 3_000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "取消失败");
    } finally {
      setBusy(null);
    }
  }

  async function createBackup(kind: BackupKind) {
    setPendingDialog(null);
    setBusy(`backup-${kind}`);
    setMessage("");
    try {
      const result = await jsonRequest<{ task: BackupTask }>("/api/ops/backups", {
        method: "POST",
        body: JSON.stringify({ kind }),
      });
      setMessage(kind === "database" ? "正在生成数据库备份…" : "正在建立完整快照并压缩附件…");
      const task = await waitForBackupTask(result.task.id);
      if (task.mediaStats) setMediaStats(task.mediaStats);
      setMessage("备份已生成，浏览器即将开始下载；服务器临时文件会随下载删除。");
      window.location.assign(
        `/api/ops/backups/download?id=${encodeURIComponent(task.id)}`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "备份生成失败");
    } finally {
      setBusy(null);
    }
  }

  function confirmPendingDialog() {
    if (!pendingDialog) return;
    if (pendingDialog.kind === "dispatch") {
      void dispatch(pendingDialog.action);
      return;
    }
    if (pendingDialog.kind === "backup") {
      void createBackup(pendingDialog.backup);
      return;
    }
    void cancelRun(pendingDialog.action, pendingDialog.run);
  }

  if (authState === "loading") {
    return <div className={styles.loading}><span className={styles.loader} />正在打开控制台…</div>;
  }

  if (authState === "anonymous") {
    return (
      <div className={styles.page}>
        <div className={styles.loginCard}>
          <div className={styles.brandMark}><span>C</span></div>
          <p className={styles.eyebrow}>PRIVATE CONSOLE</p>
          <h1 className={styles.loginTitle}>
            <span>Countdown</span>
            <span>发布控制台</span>
          </h1>
          <p className={styles.subtitle}>登录后才可构建、部署、下载备份和安装包。</p>
          <div className={styles.secureHint}><span />受保护的内部页面</div>
          <form onSubmit={login} className={styles.form}>
            <label>
              账号
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
            </label>
            <label>
              密码
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
            </label>
            {message && <p className={styles.error} role="alert">{message}</p>}
            <button type="submit" disabled={busy === "login"}>
              {busy === "login" ? "验证中…" : "进入控制台"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.console}>
        <header className={styles.header}>
          <div className={styles.headerTitle}>
            <div className={styles.brandMark}><span>C</span></div>
            <div>
            <p className={styles.eyebrow}>COUNTDOWN OPS</p>
            <h1>发布控制台</h1>
            </div>
          </div>
          <div className={styles.headerActions}>
            <span>{dashboard?.username}</span>
            <button className={styles.ghostButton} onClick={logout} disabled={busy === "logout"}>退出</button>
          </div>
        </header>

        {message && <div className={styles.notice}>{message}</div>}

        <section className={styles.statusBar}>
          <span className={`${styles.statusLight} ${dashboard?.health.ok ? styles.online : styles.offline}`} />
          <div>
            <strong>Countdown API</strong>
            <small>{dashboard?.health.ok ? "服务运行正常" : `服务异常${dashboard?.health.status ? `（${dashboard.health.status}）` : ""}`}</small>
          </div>
            <button
              className={styles.ghostButton}
              onClick={() => {
                void loadDashboard();
                void loadMediaStats();
              }}
            ><span aria-hidden="true">↻</span> 刷新</button>
        </section>

        <div className={styles.grid}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div><span className={styles.cardIcon}>API</span><h2>后端服务</h2></div>
              <button onClick={() => setPendingDialog({ kind: "dispatch", action: "deploy-api" })} disabled={Boolean(busy)}>
                {busy === "deploy-api" ? "提交中…" : "构建并部署"}
              </button>
            </div>
            <p>构建 amd64 镜像、推送阿里云、重启服务器容器，并自动健康检查。</p>
            <RunList
              action="deploy-api"
              busy={busy}
              runs={dashboard?.workflows.deployApi ?? []}
              onCancelRun={(action, run) => setPendingDialog({ kind: "cancel-run", action, run })}
            />
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div><span className={styles.cardIcon}>APK</span><h2>Android</h2></div>
              <button onClick={() => setPendingDialog({ kind: "dispatch", action: "build-android" })} disabled={Boolean(busy)}>
                {busy === "build-android" ? "提交中…" : "云端构建"}
              </button>
            </div>
            <p>在 GitHub Runner 上执行 EAS local release 构建，完成后自动上传到服务器发布目录。</p>
            <RunList
              action="build-android"
              busy={busy}
              runs={dashboard?.workflows.buildAndroid ?? []}
              onCancelRun={(action, run) => setPendingDialog({ kind: "cancel-run", action, run })}
            />
          </section>
        </div>

        <section className={`${styles.card} ${styles.backupCard}`}>
          <div className={styles.cardHeader}>
            <div><span className={styles.cardIcon}>DATA</span><h2>即时备份</h2></div>
            <span className={styles.ephemeralBadge}>临时生成 · 下载即删</span>
          </div>
          <p>备份不会在服务器长期保留。数据库适合经常下载，完整包同时包含图片和语音。</p>

          <div className={styles.backupActions}>
            <article className={styles.backupAction}>
              <div>
                <strong>数据库备份</strong>
                <small>全部业务表，压缩 SQL 格式，生成速度较快。</small>
              </div>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setPendingDialog({ kind: "backup", backup: "database" })}
              >
                {busy === "backup-database" ? "生成中…" : "生成并下载"}
              </button>
            </article>
            <article className={styles.backupAction}>
              <div>
                <strong>完整备份包</strong>
                <small>数据库 + 聊天图片 + 时间线图片 + 语音，适合灾难恢复。</small>
              </div>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setPendingDialog({ kind: "backup", backup: "complete" })}
              >
                {busy === "backup-complete" ? "压缩中…" : "生成完整包"}
              </button>
            </article>
          </div>

          <div className={styles.mediaPanel}>
            <div className={styles.mediaPanelHeader}>
              <div>
                <span>附件容量</span>
                <strong>{mediaStats ? formatBytes(mediaStats.totalBytes) : "等待统计"}</strong>
              </div>
              <button type="button" onClick={() => void loadMediaStats()} disabled={statsBusy}>
                {statsBusy ? "统计中…" : "重新统计"}
              </button>
            </div>
            {mediaStatsError ? (
              <p className={styles.mediaError}>{mediaStatsError}</p>
            ) : mediaStats ? (
              <>
                <div className={styles.capacityTrack}>
                  <span style={{ width: `${Math.min(100, (mediaStats.totalBytes / MEDIA_BUDGET_BYTES) * 100)}%` }} />
                </div>
                <div className={styles.capacityMeta}>
                  <span>已使用 {((mediaStats.totalBytes / MEDIA_BUDGET_BYTES) * 100).toFixed(1)}%</span>
                  <span>预留上限 5 GB</span>
                </div>
                <div className={styles.mediaMetrics}>
                  <div><small>图片</small><strong>{formatBytes(mediaStats.categories.chatImages.bytes + mediaStats.categories.timelineImages.bytes)}</strong></div>
                  <div><small>语音</small><strong>{formatBytes(mediaStats.categories.voice.bytes)}</strong></div>
                  <div><small>历史日均</small><strong>{formatBytes(mediaStats.averageBytesPerDay)}/天</strong></div>
                  <div><small>近 7 天日均</small><strong>{formatBytes(mediaStats.recent7DayAverageBytes)}/天</strong></div>
                </div>
                <p className={styles.forecast}>
                  {mediaForecast(mediaStats)}
                </p>
              </>
            ) : (
              <p className={styles.mediaPending}>正在读取服务器附件卷，不会下载或修改文件。</p>
            )}
          </div>
        </section>

        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div><span className={styles.cardIcon}>↓</span><h2>安装包</h2></div>
            <span className={styles.count}>{dashboard?.releases.length ?? 0} 个版本</span>
          </div>
          {!dashboard?.releases.length ? (
            <p className={styles.empty}>云端构建完成后，APK 会出现在这里。</p>
          ) : (
            <div className={styles.releaseList}>
              {dashboard.releases.map((release) => (
                <div className={styles.releaseItem} key={release.filename}>
                  <div>
                    <strong>{release.filename}</strong>
                    <small>{formatSize(release.size)} · {formatTime(release.modifiedAt)}{release.commit ? ` · ${release.commit}` : ""}</small>
                  </div>
                  <a
                    href={`/api/ops/releases/download?file=${encodeURIComponent(release.filename)}`}
                    download={release.filename}
                  >
                    从服务器下载
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {pendingDialog && (
        <ConfirmDialog
          dialog={pendingDialog}
          onCancel={() => setPendingDialog(null)}
          onConfirm={confirmPendingDialog}
        />
      )}
    </div>
  );
}
