'use client';

import { useCallback, useMemo, useState } from 'react';
import { copyToClipboard } from '../components/Toast';

const cardStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  border: '1px solid color-mix(in oklab, var(--foreground) 12%, transparent)',
  background: 'color-mix(in oklab, var(--foreground) 4%, transparent)',
};

const pageWrapStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: '0 auto',
  padding: '24px 16px',
  minHeight: 'calc(100vh - var(--app-header-h) - 48px)',
};

function itemToCopyText(item: unknown): string {
  if (item === null || item === undefined) return '';
  if (typeof item === 'string') return item;
  if (typeof item === 'number' || typeof item === 'boolean') return String(item);
  return JSON.stringify(item);
}

function parseArrayInput(input: string): { items: string[]; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) return { items: [], error: null };

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      return { items: [], error: '请输入 JSON 数组，例如 ["选项A", "选项B"]' };
    }
    return {
      items: parsed.map(itemToCopyText),
      error: null,
    };
  } catch {
    const lines = trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length > 0) {
      return { items: lines, error: null };
    }
    return { items: [], error: '无法解析：请粘贴 JSON 数组，或每行一项' };
  }
}

export default function ArrayCopyPage() {
  const [raw, setRaw] = useState('');
  const { items, error } = useMemo(() => parseArrayInput(raw), [raw]);

  const copyItem = useCallback(async (text: string) => {
    await copyToClipboard(text);
  }, []);

  return (
    <div style={pageWrapStyle}>
      <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>数组选项复制</h1>
      <p style={{ opacity: 0.7, margin: 0, fontSize: 14 }}>
        粘贴 JSON 数组（如 <code style={{ fontFamily: 'ui-monospace, monospace' }}>["a","b"]</code>
        ），或每行一项；下方会列出全部选项，点击复制即可
      </p>

      <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={cardStyle}>
          <label htmlFor="array-input" style={{ display: 'block', fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
            粘贴数组
          </label>
          <textarea
            id="array-input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={'例如：\n["选项一", "选项二", "选项三"]\n\n或每行一项：\n选项一\n选项二'}
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: 140,
              padding: 12,
              fontSize: 14,
              fontFamily: 'ui-monospace, monospace',
              lineHeight: 1.5,
              borderRadius: 8,
              border: '1px solid color-mix(in oklab, var(--foreground) 18%, transparent)',
              background: 'color-mix(in oklab, var(--background) 92%, var(--foreground))',
              color: 'var(--foreground)',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {error && (
          <div style={{ ...cardStyle, color: 'var(--foreground)', fontSize: 14 }}>{error}</div>
        )}

        {!error && items.length > 0 && (
          <div style={cardStyle}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
              共 {items.length} 项
            </div>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {items.map((text, index) => (
                <li
                  key={`${index}-${text.slice(0, 32)}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid color-mix(in oklab, var(--foreground) 10%, transparent)',
                    background: 'color-mix(in oklab, var(--foreground) 3%, transparent)',
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: 14,
                      wordBreak: 'break-all',
                    }}
                  >
                    {text || <span style={{ opacity: 0.5 }}>（空）</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyItem(text)}
                    style={{
                      flexShrink: 0,
                      padding: '6px 14px',
                      fontSize: 13,
                      borderRadius: 6,
                      border: '1px solid color-mix(in oklab, var(--foreground) 20%, transparent)',
                      background: 'color-mix(in oklab, var(--foreground) 8%, transparent)',
                      color: 'var(--foreground)',
                      cursor: 'pointer',
                    }}
                  >
                    复制
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!error && raw.trim() && items.length === 0 && (
          <div style={{ ...cardStyle, opacity: 0.85, fontSize: 14 }}>数组为空</div>
        )}
      </div>
    </div>
  );
}
