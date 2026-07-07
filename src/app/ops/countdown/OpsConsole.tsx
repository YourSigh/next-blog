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
  action,
  onCancel,
  onConfirm,
}: {
  action: DispatchAction;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const copy = actionCopy[action];

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
          {action === "deploy-api" ? "API" : "APK"}
        </div>
        <p className={styles.dialogEyebrow}>{copy.eyebrow}</p>
        <h2 id="dispatch-dialog-title">{copy.title}</h2>
        <p id="dispatch-dialog-description">{copy.description}</p>
        <div className={styles.dialogBranch}>
          <span className={styles.branchDot} />
          来源分支 <strong>main</strong>
        </div>
        <div className={styles.dialogActions}>
          <button ref={cancelButtonRef} type="button" className={styles.dialogCancel} onClick={onCancel}>
            取消
          </button>
          <button type="button" className={styles.dialogConfirm} onClick={onConfirm}>
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

function runState(run: WorkflowRun): { label: string; tone: string } {
  if (run.status !== "completed") return { label: "进行中", tone: "running" };
  if (run.conclusion === "success") return { label: "成功", tone: "success" };
  if (run.conclusion === "cancelled") return { label: "已取消", tone: "muted" };
  return { label: "失败", tone: "danger" };
}

function RunList({ runs }: { runs: WorkflowRun[] }) {
  if (!runs.length) return <p className={styles.empty}>暂无运行记录</p>;

  return (
    <div className={styles.runList}>
      {runs.map((run) => {
        const state = runState(run);
        return (
          <a key={run.id} href={run.url} target="_blank" rel="noreferrer" className={styles.runItem}>
            <span className={`${styles.stateDot} ${styles[state.tone]}`} />
            <span className={styles.runBody}>
              <strong>{state.label}</strong>
              <small>{run.commit} · {run.actor} · {formatTime(run.createdAt)}</small>
            </span>
            <span aria-hidden="true">GitHub 日志 ↗</span>
          </a>
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
  const [message, setMessage] = useState("");
  const [pendingAction, setPendingAction] = useState<DispatchAction | null>(null);

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
    setPendingAction(null);
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
          <p className={styles.subtitle}>登录后才可构建、部署和下载安装包。</p>
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
            <button className={styles.ghostButton} onClick={loadDashboard}><span aria-hidden="true">↻</span> 刷新</button>
        </section>

        <div className={styles.grid}>
          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div><span className={styles.cardIcon}>API</span><h2>后端服务</h2></div>
              <button onClick={() => setPendingAction("deploy-api")} disabled={Boolean(busy)}>
                {busy === "deploy-api" ? "提交中…" : "构建并部署"}
              </button>
            </div>
            <p>构建 amd64 镜像、推送阿里云、重启服务器容器，并自动健康检查。</p>
            <RunList runs={dashboard?.workflows.deployApi ?? []} />
          </section>

          <section className={styles.card}>
            <div className={styles.cardHeader}>
              <div><span className={styles.cardIcon}>APK</span><h2>Android</h2></div>
              <button onClick={() => setPendingAction("build-android")} disabled={Boolean(busy)}>
                {busy === "build-android" ? "提交中…" : "云端构建"}
              </button>
            </div>
            <p>在 GitHub Runner 上执行 EAS local release 构建，完成后自动上传到服务器发布目录。</p>
            <RunList runs={dashboard?.workflows.buildAndroid ?? []} />
          </section>
        </div>

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
      {pendingAction && (
        <ConfirmDialog
          action={pendingAction}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => dispatch(pendingAction)}
        />
      )}
    </div>
  );
}
