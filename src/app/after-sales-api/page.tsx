'use client';

import { useMemo, useState } from 'react';

// JSON 树形视图组件（控制台风格：key/value 同行显示，可折叠）
function JsonTreeView({ data }: { data: unknown }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['$'])); // 默认展开根节点

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  return (
    <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
      <JsonNode value={data} path="$" indent={0} expanded={expanded} toggle={toggle} />
    </div>
  );
}

function JsonPrimitive({ value }: { value: unknown }) {
  if (value === null) return <span style={{ color: '#999' }}>null</span>;
  if (value === undefined) return <span style={{ color: '#999' }}>undefined</span>;
  if (typeof value === 'string') {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return <span style={{ color: '#98c379' }}>"{escaped}"</span>;
  }
  if (typeof value === 'number') return <span style={{ color: '#d19a66' }}>{value}</span>;
  if (typeof value === 'boolean') return <span style={{ color: '#56b6c2' }}>{String(value)}</span>;
  return <span>{String(value)}</span>;
}

function JsonNode({
  value,
  path,
  indent,
  expanded,
  toggle,
}: {
  value: unknown;
  path: string;
  indent: number;
  expanded: Set<string>;
  toggle: (path: string) => void;
}) {
  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    paddingLeft: indent,
    lineHeight: '18px',
  };

  const caret: React.CSSProperties = {
    width: 14,
    flex: '0 0 14px',
    fontSize: 10,
    opacity: 0.7,
    cursor: 'pointer',
    userSelect: 'none',
  };

  const valueWrap: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    whiteSpace: 'normal',
    wordBreak: 'break-word',
  };

  // 基元：直接同行显示
  if (value === null || value === undefined || typeof value !== 'object') {
    return (
      <div style={row}>
        <span style={{ width: 14, flex: '0 0 14px' }} />
        <div style={valueWrap}>
          <JsonPrimitive value={value} />
        </div>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const isOpen = expanded.has(path);
  const openChar = isArray ? '[' : '{';
  const closeChar = isArray ? ']' : '}';
  const braceColor = isArray ? '#c678dd' : '#e06c75';

  const size = isArray
    ? (value as unknown[]).length
    : Object.keys(value as Record<string, unknown>).length;
  const summary = isArray
    ? `${size} item${size === 1 ? '' : 's'}`
    : `${size} key${size === 1 ? '' : 's'}`;

  const isEmpty = size === 0;

  return (
    <div>
      {/* 这一行：{…} / […] 与 key 同行出现 */}
      <div style={row}>
        {isEmpty ? (
          <span style={{ width: 14, flex: '0 0 14px' }} />
        ) : (
          <span style={caret} onClick={() => toggle(path)}>
            {isOpen ? '▼' : '▶'}
          </span>
        )}
        <div style={valueWrap}>
          <span style={{ color: braceColor }}>{openChar}</span>
          {isEmpty ? (
            <span style={{ color: braceColor }}>{closeChar}</span>
          ) : isOpen ? null : (
            <span style={{ color: '#5c6370', marginLeft: 6 }}>{summary}</span>
          )}
        </div>
      </div>

      {/* 展开：子项缩进；关闭括号独立一行 */}
      {isOpen && !isEmpty && (
        <div>
          {isArray
            ? (value as unknown[]).map((item, idx) => {
                const childPath = `${path}[${idx}]`;
                return (
                  <div key={childPath} style={{ display: 'flex', gap: 6, paddingLeft: indent + 20 }}>
                    <span style={{ color: '#5c6370', width: 34, flex: '0 0 34px' }}>{idx}:</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <JsonNode value={item} path={childPath} indent={0} expanded={expanded} toggle={toggle} />
                    </div>
                  </div>
                );
              })
            : Object.entries(value as Record<string, unknown>).map(([k, v]) => {
                const childPath = `${path}.${k}`;
                return (
                  <div key={childPath} style={{ display: 'flex', gap: 6, paddingLeft: indent + 20 }}>
                    <span style={{ color: '#61afef', flex: '0 0 auto' }}>"{k}":</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <JsonNode value={v} path={childPath} indent={0} expanded={expanded} toggle={toggle} />
                    </div>
                  </div>
                );
              })}

          <div style={{ paddingLeft: indent + 14, color: braceColor, lineHeight: '18px' }}>{closeChar}</div>
        </div>
      )}
    </div>
  );
}

type EnvKey = 'test' | 'prod';

const ENV = {
  test: 'https://pubapp.shb.ltd/',
  prod: 'https://cloud.shb.ltd/',
} as const satisfies Record<EnvKey, string>;

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';

type HeaderRow = {
  id: number;
  key: string;
  value: string;
  enabled: boolean;
};

function safeJsonParse(input: string) {
  try {
    return { ok: true as const, value: JSON.parse(input) as unknown };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}

export default function AfterSalesApiPage() {
  const [envKey, setEnvKey] = useState<EnvKey>('test');
  const [useFullUrl, setUseFullUrl] = useState(false);
  const [fullUrl, setFullUrl] = useState<string>(ENV.test);
  const [path, setPath] = useState('/'); // 相对路径（拼到环境地址上）
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [headersRows, setHeadersRows] = useState<HeaderRow[]>([
    { id: 1, key: 'content-type', value: 'application/json', enabled: true },
  ]);
  const [nextHeaderId, setNextHeaderId] = useState(2);
  const [bodyText, setBodyText] = useState('{\n  \n}');
  const [loading, setLoading] = useState(false);
  const [respStatus, setRespStatus] = useState<number | null>(null);
  const [respHeaders, setRespHeaders] = useState<Record<string, string>>({});
  const [respBody, setRespBody] = useState<string>('');
  const [respBodyJson, setRespBodyJson] = useState<unknown>(null); // 解析后的 JSON 对象
  const [isRespJson, setIsRespJson] = useState(false); // 是否为 JSON 响应
  const [error, setError] = useState<string>('');

  const baseUrl = ENV[envKey];

  const computedUrl = useMemo(() => {
    if (useFullUrl) return fullUrl.trim();
    const base = baseUrl.trim();
    const p = path.trim();
    if (!p) return base;
    try {
      return new URL(p, base).toString();
    } catch {
      return base;
    }
  }, [useFullUrl, fullUrl, baseUrl, path]);

  function buildHeadersObject() {
    const headers: Record<string, string> = {};
    headersRows.forEach((row) => {
      const key = row.key.trim();
      if (!row.enabled || !key) return;
      headers[key.toLowerCase()] = row.value;
    });
    return headers;
  }

  function handleAddHeader() {
    setHeadersRows((rows) => [
      ...rows,
      { id: nextHeaderId, key: '', value: '', enabled: true },
    ]);
    setNextHeaderId((id) => id + 1);
  }

  function handleChangeHeader(
    id: number,
    field: 'key' | 'value' | 'enabled',
    value: string | boolean,
  ) {
    setHeadersRows((rows) =>
      rows.map((row) =>
        row.id === id
          ? { ...row, [field]: value }
          : row,
      ),
    );
  }

  function handleRemoveHeader(id: number) {
    setHeadersRows((rows) => rows.filter((row) => row.id !== id));
  }

  function formatBodyJson() {
    if (!bodyText.trim()) return;
    const parsed = safeJsonParse(bodyText);
    if (!parsed.ok) {
      setError(`Body 不是合法 JSON：${parsed.error}`);
      return;
    }
    setBodyText(JSON.stringify(parsed.value, null, 2));
  }

  async function copyResponse() {
    if (!respBody) return;
    try {
      await navigator.clipboard.writeText(respBody);
    } catch {
      // 忽略无剪贴板权限的情况
    }
  }

  async function send() {
    setLoading(true);
    setError('');
    setRespStatus(null);
    setRespHeaders({});
    setRespBody('');
    setRespBodyJson(null);
    setIsRespJson(false);

    const headers = buildHeadersObject();

    const shouldSendBody = method !== 'GET' && method !== 'HEAD';
    const body = shouldSendBody ? bodyText : undefined;

    try {
      const res = await fetch('/api/shb/proxy', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url: computedUrl,
          method,
          headers,
          body,
        }),
      });

      setRespStatus(res.status);
      const outHeaders: Record<string, string> = {};
      res.headers.forEach((v, k) => (outHeaders[k] = v));
      setRespHeaders(outHeaders);

      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const json = await res.json().catch(() => null);
        if (json) {
          setRespBody(JSON.stringify(json, null, 2));
          setRespBodyJson(json);
          setIsRespJson(true);
        } else {
          setRespBody('');
          setRespBodyJson(null);
          setIsRespJson(false);
        }
      } else {
        const text = await res.text().catch(() => '');
        setRespBody(text);
        setRespBodyJson(null);
        setIsRespJson(false);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ fontSize: 28, margin: '8px 0 12px' }}>售后宝接口调用</h1>
      <p style={{ opacity: 0.85, lineHeight: 1.7, marginBottom: 16 }}>
        选择环境后输入路径或完整 URL，点击“发送”即可。为了绕过浏览器 CORS，这里通过站内服务端代理转发
      </p>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr' }}>
        <div
          style={{
            display: 'grid',
            gap: 10,
            padding: 12,
            border: '1px solid color-mix(in oklab, var(--foreground) 16%, transparent)',
            borderRadius: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ opacity: 0.8 }}>环境</span>
              <select
                value={envKey}
                onChange={(e) => {
                  const next = e.target.value as EnvKey;
                  setEnvKey(next);
                  setFullUrl(ENV[next]);
                }}
              >
                <option value="test">测试环境</option>
                <option value="prod">生产环境（独立端）</option>
              </select>
            </label>

            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={useFullUrl}
                onChange={(e) => setUseFullUrl(e.target.checked)}
              />
              <span style={{ opacity: 0.8 }}>使用完整 URL</span>
            </label>

            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ opacity: 0.8 }}>方法</span>
              <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)}>
                {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={send}
              disabled={loading}
              style={{
                height: 34,
                padding: '0 12px',
                borderRadius: 10,
                border: '1px solid color-mix(in oklab, var(--foreground) 18%, transparent)',
                background: 'color-mix(in oklab, var(--foreground) 10%, transparent)',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? '发送中…' : '发送'}
            </button>
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ opacity: 0.75, fontSize: 12 }}>
              目标地址：<span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>{computedUrl}</span>
            </div>

            {useFullUrl ? (
              <input
                value={fullUrl}
                onChange={(e) => setFullUrl(e.target.value)}
                placeholder="https://..."
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #3333' }}
              />
            ) : (
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/api/xxx 或 /shb/xxx"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #3333' }}
              />
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
          <div
            style={{
              padding: 12,
              border: '1px solid color-mix(in oklab, var(--foreground) 16%, transparent)',
              borderRadius: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ opacity: 0.8 }}>Headers</div>
              <button
                type="button"
                onClick={handleAddHeader}
                style={{
                  fontSize: 12,
                  padding: '4px 8px',
                  borderRadius: 8,
                  border: '1px solid #4444',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                + 添加 Header
              </button>
            </div>
            <div style={{ display: 'grid', gap: 6 }}>
              {headersRows.map((row) => (
                <div
                  key={row.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1.2fr 1.8fr auto',
                    gap: 6,
                    alignItems: 'center',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) => handleChangeHeader(row.id, 'enabled', e.target.checked)}
                  />
                  <input
                    value={row.key}
                    onChange={(e) => handleChangeHeader(row.id, 'key', e.target.value)}
                    placeholder="Header 名（如 content-type）"
                    style={{
                      padding: '6px 8px',
                      borderRadius: 8,
                      border: '1px solid #3333',
                      fontSize: 12,
                    }}
                  />
                  <input
                    value={row.value}
                    onChange={(e) => handleChangeHeader(row.id, 'value', e.target.value)}
                    placeholder="Header 值"
                    style={{
                      padding: '6px 8px',
                      borderRadius: 8,
                      border: '1px solid #3333',
                      fontSize: 12,
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveHeader(row.id)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      opacity: 0.7,
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {headersRows.length === 0 && (
                <div style={{ opacity: 0.6, fontSize: 12 }}>暂无 Header，可点击右上角按钮添加。</div>
              )}
            </div>
          </div>

          <div
            style={{
              padding: 12,
              border: '1px solid color-mix(in oklab, var(--foreground) 16%, transparent)',
              borderRadius: 12,
              opacity: method === 'GET' || method === 'HEAD' ? 0.6 : 1,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ opacity: 0.8 }}>Body（文本/JSON，GET/HEAD 不发送）</div>
              <button
                type="button"
                onClick={formatBodyJson}
                disabled={!bodyText.trim()}
                style={{
                  fontSize: 12,
                  padding: '4px 8px',
                  borderRadius: 8,
                  border: '1px solid #4444',
                  background: 'transparent',
                  cursor: bodyText.trim() ? 'pointer' : 'not-allowed',
                  opacity: bodyText.trim() ? 0.9 : 0.4,
                }}
              >
                一键格式化 JSON
              </button>
            </div>
            <textarea
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              rows={10}
              spellCheck={false}
              disabled={method === 'GET' || method === 'HEAD'}
              style={{ width: '100%', padding: 10, borderRadius: 10, border: '1px solid #3333', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
            />
          </div>
        </div>

        <div
          style={{
            padding: 12,
            border: '1px solid color-mix(in oklab, var(--foreground) 16%, transparent)',
            borderRadius: 12,
          }}
        >
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ opacity: 0.8 }}>响应</div>
            {respStatus !== null && (
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', opacity: 0.9 }}>
                Status: {respStatus}
              </div>
            )}
            {error && <div style={{ color: '#ff6b6b' }}>{error}</div>}
            <button
              type="button"
              onClick={copyResponse}
              disabled={!respBody}
              style={{
                marginLeft: 'auto',
                fontSize: 12,
                padding: '4px 8px',
                borderRadius: 8,
                border: '1px solid #4444',
                background: 'transparent',
                cursor: respBody ? 'pointer' : 'not-allowed',
                opacity: respBody ? 0.9 : 0.4,
              }}
            >
              复制响应
            </button>
          </div>

          <details style={{ marginBottom: 10 }}>
            <summary style={{ cursor: 'pointer', opacity: 0.85 }}>响应 Headers</summary>
            <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: 'pre-wrap' }}>
              {Object.keys(respHeaders).length ? JSON.stringify(respHeaders, null, 2) : '(empty)'}
            </pre>
          </details>

          <div
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 10,
              border: '1px solid #3333',
              minHeight: 180,
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 13,
              lineHeight: 1.6,
              background: 'color-mix(in oklab, var(--background) 98%, var(--foreground))',
            }}
          >
            {isRespJson && respBodyJson !== null ? (
              <JsonTreeView data={respBodyJson} />
            ) : respBody ? (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {respBody}
              </pre>
            ) : (
              <span style={{ opacity: 0.6 }}>(no body)</span>
            )}
          </div>
        </div>
      </div>

      <p style={{ opacity: 0.7, marginTop: 16, lineHeight: 1.6 }}>
        环境入口参考：
        <br />
        - 测试环境：{ENV.test}
        <br />
        - 生产环境（独立端）：{ENV.prod}
      </p>
    </div>
  );
}

