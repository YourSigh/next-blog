"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./download.module.css";

type Release = {
  filename: string;
  size: number;
  modifiedAt: string;
  commit?: string;
  notes?: string;
  version?: string;
  versionCode?: number;
};

type ViewState = "loading" | "locked" | "ready";

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function DownloadPortal() {
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [accessKey, setAccessKey] = useState("");
  const [releases, setReleases] = useState<Release[]>([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadReleases = useCallback(async () => {
    const response = await fetch("/api/apk/releases", { cache: "no-store" });
    if (response.status === 401) {
      setViewState("locked");
      setReleases([]);
      return;
    }

    const body = (await response.json().catch(() => ({}))) as {
      releases?: Release[];
      error?: string;
    };
    if (!response.ok) throw new Error(body.error || "安装包列表加载失败");

    setReleases(body.releases ?? []);
    setViewState("ready");
  }, []);

  useEffect(() => {
    loadReleases().catch((reason) => {
      setError(reason instanceof Error ? reason.message : "安装包列表加载失败");
      setViewState("locked");
    });
  }, [loadReleases]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/apk/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessKey }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "验证失败");
      setAccessKey("");
      await loadReleases();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验证失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function lockPage() {
    await fetch("/api/apk/auth", { method: "DELETE" }).catch(() => null);
    setReleases([]);
    setViewState("locked");
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand} aria-hidden="true">C</div>
          <div>
            <p className={styles.eyebrow}>COUNTDOWN FOR ANDROID</p>
            <h1>安装包下载</h1>
            <p className={styles.lead}>从私有服务器获取最新的 64 位 Android 安装包。</p>
          </div>
          {viewState === "ready" && (
            <button className={styles.lockButton} type="button" onClick={lockPage}>
              锁定页面
            </button>
          )}
        </header>

        {viewState === "loading" && (
          <section className={styles.stateCard}>
            <span className={styles.spinner} />
            <p>正在检查访问权限…</p>
          </section>
        )}

        {viewState === "locked" && (
          <section className={styles.unlockCard}>
            <p className={styles.cardLabel}>PRIVATE RELEASE</p>
            <h2>输入访问口令</h2>
            <p>验证通过后即可查看版本说明并下载安装包。</p>
            <form onSubmit={unlock} className={styles.form}>
              <label htmlFor="download-access-key">访问口令</label>
              <input
                id="download-access-key"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={accessKey}
                onChange={(event) => setAccessKey(event.target.value)}
                placeholder="请输入访问口令"
                required
                autoFocus
              />
              {error && <p className={styles.error} role="alert">{error}</p>}
              <button type="submit" disabled={submitting}>
                {submitting ? "验证中…" : "查看安装包"}
              </button>
            </form>
          </section>
        )}

        {viewState === "ready" && (
          <section className={styles.releaseSection}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.cardLabel}>SERVER RELEASES</p>
                <h2>最近版本</h2>
              </div>
              <span>{releases.length} 个安装包</span>
            </div>

            {!releases.length ? (
              <div className={styles.empty}>暂时没有可下载的安装包。</div>
            ) : (
              <div className={styles.releaseList}>
                {releases.map((release, index) => (
                  <article className={styles.releaseCard} key={release.filename}>
                    <div className={styles.releaseTop}>
                      <div className={styles.releaseTitle}>
                        <div className={styles.badges}>
                          {index === 0 && <span className={styles.latest}>最新</span>}
                          {release.version && (
                            <span className={styles.commit}>v{release.version}</span>
                          )}
                          {release.commit && <span className={styles.commit}>{release.commit}</span>}
                        </div>
                        <h3>{release.filename}</h3>
                        <p>{formatTime(release.modifiedAt)} · {formatSize(release.size)}</p>
                      </div>
                      <a
                        className={styles.downloadButton}
                        href={`/api/apk/download?file=${encodeURIComponent(release.filename)}`}
                        download={release.filename}
                      >
                        下载 APK
                      </a>
                    </div>
                    <div className={styles.notes}>
                      <strong>本次更新</strong>
                      <p>{release.notes || "这个版本暂未记录 commit 更新说明。"}</p>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <footer className={styles.footer}>仅支持 ARM64 Android 设备 · 文件由 yoursigh.top 提供</footer>
      </div>
    </div>
  );
}
