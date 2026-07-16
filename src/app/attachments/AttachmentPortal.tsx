"use client";

import { ChangeEvent, DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import styles from "./attachments.module.css";

const STORAGE_KEY = "attachment_access_key";

type Attachment = {
  filename: string;
  size: number;
  modifiedAt: string;
  contentType: string;
  isImage: boolean;
};

type AttachmentGroup = {
  name: string;
  count: number;
};

type ViewState = "loading" | "locked" | "ready";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
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

function fileUrl(filename: string, group: string, preview = false): string {
  const query = new URLSearchParams({ file: filename });
  if (group) query.set("group", group);
  if (preview) query.set("preview", "1");
  return `/api/attachments/file?${query}`;
}

export default function AttachmentPortal() {
  const [viewState, setViewState] = useState<ViewState>("loading");
  const [accessKey, setAccessKey] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [groups, setGroups] = useState<AttachmentGroup[]>([]);
  const [activeGroup, setActiveGroup] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [showGroupForm, setShowGroupForm] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [deletingFile, setDeletingFile] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const loadAttachments = useCallback(async (group = "", key?: string) => {
    const query = group ? `?${new URLSearchParams({ group })}` : "";
    const response = await fetch(`/api/attachments${query}`, {
      cache: "no-store",
      headers: key ? { Authorization: `Bearer ${key}` } : undefined,
    });
    if (response.status === 401) throw new Error("UNAUTHORIZED");
    const body = (await response.json().catch(() => ({}))) as {
      attachments?: Attachment[];
      groups?: AttachmentGroup[];
      error?: string;
    };
    if (!response.ok) throw new Error(body.error || "附件列表加载失败");
    setAttachments(body.attachments ?? []);
    setGroups(body.groups ?? []);
    setActiveGroup(group);
    setViewState("ready");
  }, []);

  const verifyKey = useCallback(async (key: string, remember: boolean) => {
    const response = await fetch("/api/apk/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKey: key }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(body.error || "验证失败");
    if (remember) localStorage.setItem(STORAGE_KEY, key);
    await loadAttachments("", key);
  }, [loadAttachments]);

  useEffect(() => {
    const savedKey = localStorage.getItem(STORAGE_KEY);
    loadAttachments("").catch(async (reason) => {
      if (reason instanceof Error && reason.message === "UNAUTHORIZED" && savedKey) {
        try {
          await verifyKey(savedKey, false);
          return;
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      setViewState("locked");
      if (!(reason instanceof Error && reason.message === "UNAUTHORIZED")) {
        setError(reason instanceof Error ? reason.message : "附件列表加载失败");
      }
    });
  }, [loadAttachments, verifyKey]);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await verifyKey(accessKey.trim(), true);
      setAccessKey("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验证失败");
    } finally {
      setSubmitting(false);
    }
  }

  function pickFiles(files: FileList | null) {
    if (!files) return;
    setSelectedFiles(Array.from(files).slice(0, 20));
    setError("");
    setNotice("");
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    pickFiles(event.dataTransfer.files);
  }

  async function upload() {
    if (!selectedFiles.length) return;
    setSubmitting(true);
    setError("");
    setNotice("");
    const formData = new FormData();
    selectedFiles.forEach((file) => formData.append("files", file));
    if (activeGroup) formData.append("group", activeGroup);
    const key = localStorage.getItem(STORAGE_KEY);

    try {
      const response = await fetch("/api/attachments", {
        method: "POST",
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
        body: formData,
      });
      const body = (await response.json().catch(() => ({}))) as {
        attachments?: Attachment[];
        error?: string;
      };
      if (response.status === 401) {
        localStorage.removeItem(STORAGE_KEY);
        setViewState("locked");
        throw new Error("访问密钥已失效，请重新验证");
      }
      if (!response.ok) throw new Error(body.error || "上传失败");
      setNotice(`已成功上传 ${body.attachments?.length ?? selectedFiles.length} 个文件`);
      setSelectedFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      await loadAttachments(activeGroup, key || undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function switchGroup(group: string) {
    setError("");
    setNotice("");
    setPreview(null);
    try {
      await loadAttachments(group, localStorage.getItem(STORAGE_KEY) || undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分组加载失败");
    }
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name) return;
    setSubmitting(true);
    setError("");
    const key = localStorage.getItem(STORAGE_KEY);
    try {
      const response = await fetch("/api/attachments/groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify({ name }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        group?: AttachmentGroup;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || "分组创建失败");
      setNewGroupName("");
      setShowGroupForm(false);
      setNotice(`分组“${body.group?.name || name}”已创建`);
      await loadAttachments(body.group?.name || name, key || undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分组创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeAttachment(attachment: Attachment) {
    if (!window.confirm(`确定删除“${attachment.filename}”吗？删除后无法恢复。`)) return;
    setDeletingFile(attachment.filename);
    setError("");
    setNotice("");
    const query = new URLSearchParams({ file: attachment.filename });
    if (activeGroup) query.set("group", activeGroup);
    const key = localStorage.getItem(STORAGE_KEY);
    try {
      const response = await fetch(`/api/attachments?${query}`, {
        method: "DELETE",
        headers: key ? { Authorization: `Bearer ${key}` } : undefined,
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "删除失败");
      if (preview?.filename === attachment.filename) setPreview(null);
      setNotice(`已删除 ${attachment.filename}`);
      await loadAttachments(activeGroup, key || undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败");
    } finally {
      setDeletingFile("");
    }
  }

  async function lockPage() {
    localStorage.removeItem(STORAGE_KEY);
    await fetch("/api/apk/auth", { method: "DELETE" }).catch(() => undefined);
    setAttachments([]);
    setGroups([]);
    setActiveGroup("");
    setSelectedFiles([]);
    setPreview(null);
    setViewState("locked");
  }

  if (viewState === "loading") {
    return <main className={styles.page}><div className={styles.loading}><span />正在验证访问权限…</div></main>;
  }

  if (viewState === "locked") {
    return (
      <main className={styles.page}>
        <section className={styles.unlockCard}>
          <div className={styles.logo} aria-hidden="true">↥</div>
          <p className={styles.kicker}>PRIVATE STORAGE</p>
          <h1>附件中心</h1>
          <p className={styles.muted}>输入访问密钥后即可上传、预览和下载附件。验证成功后，本设备会记住密钥。</p>
          <form onSubmit={unlock} className={styles.unlockForm}>
            <label htmlFor="attachment-access-key">访问密钥</label>
            <input
              id="attachment-access-key"
              type="password"
              autoComplete="current-password"
              value={accessKey}
              onChange={(event) => setAccessKey(event.target.value)}
              placeholder="请输入访问密钥"
              required
              autoFocus
            />
            {error && <p className={styles.error} role="alert">{error}</p>}
            <button type="submit" disabled={submitting}>{submitting ? "验证中…" : "进入附件中心"}</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.kicker}>PRIVATE STORAGE</p>
            <h1>附件中心</h1>
            <p className={styles.muted}>安全上传、查看和下载你的文件。</p>
          </div>
          <button className={styles.lockButton} type="button" onClick={lockPage}>清除密钥并退出</button>
        </header>

        <section className={styles.groupBar}>
          <div className={styles.groupTabs} aria-label="附件分组">
            {groups.map((group) => (
              <button
                key={group.name || "__ungrouped__"}
                type="button"
                className={activeGroup === group.name ? styles.activeGroup : ""}
                onClick={() => switchGroup(group.name)}
              >
                <span>{group.name || "未分组"}</span><i>{group.count}</i>
              </button>
            ))}
          </div>
          {!showGroupForm ? (
            <button className={styles.addGroupButton} type="button" onClick={() => setShowGroupForm(true)}>＋ 新建分组</button>
          ) : (
            <form className={styles.groupForm} onSubmit={createGroup}>
              <input
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                placeholder="分组名称"
                maxLength={80}
                autoFocus
                required
              />
              <button type="submit" disabled={submitting}>创建</button>
              <button type="button" onClick={() => { setShowGroupForm(false); setNewGroupName(""); }}>取消</button>
            </form>
          )}
        </section>

        <section className={styles.uploadCard}>
          <div
            className={`${styles.dropzone} ${dragging ? styles.dragging : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}
          >
            <div className={styles.uploadIcon} aria-hidden="true">＋</div>
            <strong>上传到“{activeGroup || "未分组"}”</strong>
            <span>或点击选择文件，单个文件最大 20 MB</span>
            <input
              ref={inputRef}
              type="file"
              multiple
              onChange={(event: ChangeEvent<HTMLInputElement>) => pickFiles(event.target.files)}
              hidden
            />
          </div>

          {selectedFiles.length > 0 && (
            <div className={styles.selection}>
              <div>
                <strong>已选择 {selectedFiles.length} 个文件</strong>
                <p>{selectedFiles.map((file) => file.name).join("、")}</p>
              </div>
              <button type="button" onClick={upload} disabled={submitting}>
                {submitting ? "上传中…" : "开始上传"}
              </button>
            </div>
          )}
          {error && <p className={styles.error} role="alert">{error}</p>}
          {notice && <p className={styles.notice} role="status">{notice}</p>}
        </section>

        <section className={styles.fileSection}>
          <div className={styles.sectionTitle}>
            <div><p className={styles.kicker}>FILES</p><h2>{activeGroup || "未分组"}</h2></div>
            <span>{attachments.length} 个文件</span>
          </div>

          {!attachments.length ? (
            <div className={styles.empty}>还没有附件，上传第一个文件吧。</div>
          ) : (
            <div className={styles.grid}>
              {attachments.map((attachment) => (
                <article className={styles.fileCard} key={attachment.filename}>
                  {attachment.isImage ? (
                    <button className={styles.thumbnail} type="button" onClick={() => setPreview(attachment)} aria-label={`预览 ${attachment.filename}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={fileUrl(attachment.filename, activeGroup, true)} alt="" loading="lazy" />
                    </button>
                  ) : (
                    <div className={styles.fileIcon} aria-hidden="true">{attachment.filename.split(".").pop()?.slice(0, 4).toUpperCase() || "FILE"}</div>
                  )}
                  <div className={styles.fileInfo}>
                    <h3 title={attachment.filename}>{attachment.filename}</h3>
                    <p>{formatSize(attachment.size)} · {formatTime(attachment.modifiedAt)}</p>
                  </div>
                  <div className={styles.actions}>
                    {attachment.isImage && <button type="button" onClick={() => setPreview(attachment)}>预览</button>}
                    <a href={fileUrl(attachment.filename, activeGroup)} download={attachment.filename}>下载</a>
                    <button
                      className={styles.deleteButton}
                      type="button"
                      onClick={() => removeAttachment(attachment)}
                      disabled={deletingFile === attachment.filename}
                    >
                      {deletingFile === attachment.filename ? "删除中" : "删除"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {preview && (
        <div className={styles.modal} role="dialog" aria-modal="true" aria-label={`预览 ${preview.filename}`} onClick={() => setPreview(null)}>
          <div className={styles.modalContent} onClick={(event) => event.stopPropagation()}>
            <div className={styles.modalHeader}><strong>{preview.filename}</strong><button type="button" onClick={() => setPreview(null)} aria-label="关闭预览">×</button></div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(preview.filename, activeGroup, true)} alt={preview.filename} />
          </div>
        </div>
      )}
    </main>
  );
}
