'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const INDENT_SIZE = 2;

/** 为 JSON 文本框提供 Tab 插入缩进、Enter 智能换行并保持缩进 */
function useJsonTextarea(
  value: string,
  setValue: (s: string) => void
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCursorRef = useRef<number | null>(null);

  useEffect(() => {
    if (pendingCursorRef.current === null || !textareaRef.current) return;
    const pos = pendingCursorRef.current;
    pendingCursorRef.current = null;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(pos, pos);
  }, [value]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const text = value;

      if (e.key === 'Tab') {
        e.preventDefault();
        const spaces = ' '.repeat(INDENT_SIZE);
        const newText = text.slice(0, start) + spaces + text.slice(end);
        setValue(newText);
        pendingCursorRef.current = start + spaces.length;
        return;
      }

      if (e.key === 'Enter') {
        e.preventDefault();
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const currentLine = text.slice(lineStart, start);
        const baseIndent = (currentLine.match(/^(\s*)/) || [])[1] || '';
        const afterBrace = /[\{\[]\s*$/.test(currentLine);
        const newIndent = afterBrace ? baseIndent + ' '.repeat(INDENT_SIZE) : baseIndent;
        const inserted = '\n' + newIndent;
        const newText = text.slice(0, start) + inserted + text.slice(end);
        setValue(newText);
        pendingCursorRef.current = start + inserted.length;
        return;
      }
    },
    [value, setValue]
  );

  return { textareaRef, onKeyDown };
}

type DiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

interface DiffItem {
  path: string;
  kind: DiffKind;
  valueLeft?: unknown;
  valueRight?: unknown;
}

function flattenPaths(obj: unknown, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj === null || typeof obj !== 'object') {
    if (prefix !== '') out[prefix] = obj;
    return out;
  }
  if (Array.isArray(obj)) {
    const pathKey = prefix === '' ? '[]' : prefix;
    out[pathKey] = obj;
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0) {
      Object.assign(out, flattenPaths(v, path));
    } else {
      out[path] = v;
    }
  }
  return out;
}

function compareJson(textLeft: string, textRight: string): { ok: true; items: DiffItem[] } | { ok: false; error: string } {
  let left: unknown;
  let right: unknown;
  try {
    left = textLeft.trim() ? JSON.parse(textLeft) : {};
  } catch {
    return { ok: false, error: '左侧 JSON 格式错误' };
  }
  try {
    right = textRight.trim() ? JSON.parse(textRight) : {};
  } catch {
    return { ok: false, error: '右侧 JSON 格式错误' };
  }

  const flatLeft = flattenPaths(left);
  const flatRight = flattenPaths(right);
  const allPaths = new Set([...Object.keys(flatLeft), ...Object.keys(flatRight)]);
  const items: DiffItem[] = [];

  for (const path of Array.from(allPaths).sort()) {
    const inLeft = path in flatLeft;
    const inRight = path in flatRight;
    const valLeft = flatLeft[path];
    const valRight = flatRight[path];

    if (!inLeft && inRight) {
      items.push({ path, kind: 'added', valueRight: valRight });
    } else if (inLeft && !inRight) {
      items.push({ path, kind: 'removed', valueLeft: valLeft });
    } else if (JSON.stringify(valLeft) !== JSON.stringify(valRight)) {
      items.push({ path, kind: 'changed', valueLeft: valLeft, valueRight: valRight });
    } else {
      items.push({ path, kind: 'unchanged', valueLeft: valLeft, valueRight: valRight });
    }
  }

  return { ok: true, items };
}

function formatValue(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return `"${v}"`;
  return JSON.stringify(v);
}

/** 尝试格式化 JSON，失败则返回原串 */
function formatJsonString(str: string, indent = 2): string {
  const t = str.trim();
  if (!t) return t;
  try {
    return JSON.stringify(JSON.parse(t), null, indent);
  } catch {
    return str;
  }
}

const PANEL_BORDER = '1px solid color-mix(in oklab, var(--foreground) 16%, transparent)';
const PANEL_HEAD_BG = 'color-mix(in oklab, var(--background) 96%, var(--foreground))';
const VSCODE_RED_BG = 'rgba(255, 180, 180, 0.5)';
const VSCODE_RED_BORDER = 'rgba(200, 80, 80, 0.6)';
const VSCODE_GREEN_BG = 'rgba(180, 255, 180, 0.5)';
const VSCODE_GREEN_BORDER = 'rgba(80, 180, 80, 0.6)';
/** 编辑区行内“已修改”高亮（与 VSCode 一致） */
const VSCODE_YELLOW_BG = 'rgba(255, 253, 180, 0.6)';

const EDITOR_LINE_HEIGHT_PX = 22;
const EDITOR_PADDING_PX = 16;

type LeftLineKind = 'removed' | 'changed' | 'unchanged';
type RightLineKind = 'added' | 'changed' | 'unchanged';

function getJsonLineKey(line: string): string | null {
  const m = line.match(/^\s*"([^"]+)"\s*:/);
  return m ? m[1] : null;
}

/** 行级 diff：左侧每行 → removed/changed/unchanged，右侧每行 → added/changed/unchanged */
function computeLineDiff(
  textLeft: string,
  textRight: string
): { left: LeftLineKind[]; right: RightLineKind[] } {
  const leftLines = textLeft.split('\n');
  const rightLines = textRight.split('\n');
  const n = leftLines.length;
  const m = rightLines.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        leftLines[i - 1] === rightLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const left: LeftLineKind[] = leftLines.map(() => 'removed');
  const right: RightLineKind[] = rightLines.map(() => 'added');
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      left[i - 1] = 'unchanged';
      right[j - 1] = 'unchanged';
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      j--;
    } else {
      i--;
    }
  }

  const usedRight = new Set<number>();
  for (let li = 0; li < n; li++) {
    if (left[li] !== 'removed') continue;
    const key = getJsonLineKey(leftLines[li]);
    if (!key) continue;
    for (let rj = 0; rj < m; rj++) {
      if (right[rj] !== 'added' || usedRight.has(rj)) continue;
      if (getJsonLineKey(rightLines[rj]) === key) {
        left[li] = 'changed';
        right[rj] = 'changed';
        usedRight.add(rj);
        break;
      }
    }
  }

  return { left, right };
}

function lineKindToBgLeft(k: LeftLineKind): string {
  if (k === 'removed') return VSCODE_RED_BG;
  if (k === 'changed') return VSCODE_YELLOW_BG;
  return 'transparent';
}

function lineKindToBgRight(k: RightLineKind): string {
  if (k === 'added') return VSCODE_GREEN_BG;
  if (k === 'changed') return VSCODE_YELLOW_BG;
  return 'transparent';
}

interface JsonEditorWithHighlightsProps {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  lineBgs: string[];
  placeholder?: string;
}

function JsonEditorWithHighlights({
  value,
  onChange,
  onKeyDown,
  textareaRef,
  lineBgs,
  placeholder,
}: JsonEditorWithHighlightsProps) {
  const lines = value.split('\n');
  const lineCount = Math.max(lines.length, 1);
  const contentHeight = EDITOR_PADDING_PX * 2 + lineCount * EDITOR_LINE_HEIGHT_PX;

  return (
    <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
      <div
        style={{
          position: 'relative',
          minHeight: '100%',
          height: contentHeight,
          padding: `${EDITOR_PADDING_PX}px`,
          boxSizing: 'border-box',
        }}
      >
        {/* 行背景层（仅背景，不挡点击） */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            padding: `${EDITOR_PADDING_PX}px 0`,
            pointerEvents: 'none',
            boxSizing: 'border-box',
          }}
        >
          {lines.map((_, i) => (
            <div
              key={i}
              style={{
                height: EDITOR_LINE_HEIGHT_PX,
                background: lineBgs[i] ?? 'transparent',
                marginBottom: i < lines.length - 1 ? 0 : undefined,
              }}
            />
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          spellCheck={false}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100%',
            height: '100%',
            padding: EDITOR_PADDING_PX,
            margin: 0,
            border: 'none',
            outline: 'none',
            resize: 'none',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 14,
            lineHeight: `${EDITOR_LINE_HEIGHT_PX}px`,
            background: 'transparent',
            color: 'var(--foreground)',
            boxSizing: 'border-box',
          }}
        />
      </div>
    </div>
  );
}

export default function JsonDiffPage() {
  const [jsonLeft, setJsonLeft] = useState('{\n  "name": "示例",\n  "count": 1\n}');
  const [jsonRight, setJsonRight] = useState('{\n  "name": "示例",\n  "count": 2,\n  "extra": true\n}');
  const [result, setResult] = useState<{ ok: true; items: DiffItem[] } | { ok: false; error: string } | null>(null);
  const [filterKind, setFilterKind] = useState<DiffKind | 'all'>('all');

  const leftEditor = useJsonTextarea(jsonLeft, setJsonLeft);
  const rightEditor = useJsonTextarea(jsonRight, setJsonRight);

  const lineDiff = useMemo(() => computeLineDiff(jsonLeft, jsonRight), [jsonLeft, jsonRight]);
  const leftLineBgs = useMemo(() => lineDiff.left.map(lineKindToBgLeft), [lineDiff.left]);
  const rightLineBgs = useMemo(() => lineDiff.right.map(lineKindToBgRight), [lineDiff.right]);

  const runDiff = useCallback(() => {
    setResult(compareJson(jsonLeft, jsonRight));
  }, [jsonLeft, jsonRight]);

  useEffect(() => {
    runDiff();
  }, [runDiff]);

  const filteredItems =
    result?.ok === true && result.items
      ? filterKind === 'all'
        ? result.items
        : result.items.filter((i) => i.kind === filterKind)
      : [];

  const counts =
    result?.ok === true
      ? {
          added: result.items.filter((i) => i.kind === 'added').length,
          removed: result.items.filter((i) => i.kind === 'removed').length,
          changed: result.items.filter((i) => i.kind === 'changed').length,
          unchanged: result.items.filter((i) => i.kind === 'unchanged').length,
        }
      : null;

  return (
    <div
      style={{
        maxWidth: 1400,
        margin: '0 auto',
        padding: '24px 16px',
        height: 'calc(100vh - var(--app-header-h) - 48px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>JSON 对比</h1>
          <p style={{ opacity: 0.7, margin: 0, fontSize: 14 }}>
            左右两侧分别填入 JSON，自动对比键值差异
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => {
              setJsonLeft(formatJsonString(jsonLeft));
              setJsonRight(formatJsonString(jsonRight));
            }}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: PANEL_BORDER,
              background: 'color-mix(in oklab, var(--foreground) 10%, transparent)',
              color: 'var(--foreground)',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            一键格式化
          </button>
          <button
            onClick={runDiff}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: PANEL_BORDER,
              background: 'color-mix(in oklab, var(--foreground) 10%, transparent)',
              color: 'var(--foreground)',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            重新对比
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          flex: 1,
          minHeight: 0,
          border: PANEL_BORDER,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', borderRight: PANEL_BORDER }}>
          <div
            style={{
              padding: '12px 16px',
              borderBottom: PANEL_BORDER,
              background: PANEL_HEAD_BG,
              fontSize: 14,
              fontWeight: 500,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>JSON 左侧（旧 / A）</span>
            <button
              type="button"
              onClick={() => setJsonLeft(formatJsonString(jsonLeft))}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: PANEL_BORDER,
                background: 'transparent',
                color: 'var(--foreground)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              格式化
            </button>
          </div>
          <JsonEditorWithHighlights
            value={jsonLeft}
            onChange={setJsonLeft}
            onKeyDown={leftEditor.onKeyDown}
            textareaRef={leftEditor.textareaRef}
            lineBgs={leftLineBgs}
            placeholder='{"a": 1}'
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              padding: '12px 16px',
              borderBottom: PANEL_BORDER,
              background: PANEL_HEAD_BG,
              fontSize: 14,
              fontWeight: 500,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>JSON 右侧（新 / B）</span>
            <button
              type="button"
              onClick={() => setJsonRight(formatJsonString(jsonRight))}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: PANEL_BORDER,
                background: 'transparent',
                color: 'var(--foreground)',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              格式化
            </button>
          </div>
          <JsonEditorWithHighlights
            value={jsonRight}
            onChange={setJsonRight}
            onKeyDown={rightEditor.onKeyDown}
            textareaRef={rightEditor.textareaRef}
            lineBgs={rightLineBgs}
            placeholder='{"a": 2}'
          />
        </div>
      </div>

      {/* 差异结果区 */}
      <div
        style={{
          marginTop: 16,
          border: PANEL_BORDER,
          borderRadius: 12,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: 320,
          minHeight: 120,
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            borderBottom: PANEL_BORDER,
            background: PANEL_HEAD_BG,
            fontSize: 14,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span>对比结果</span>
          {result?.ok === false && (
            <span style={{ color: 'var(--foreground)', background: 'color-mix(in oklab, red 25%, transparent)', padding: '2px 8px', borderRadius: 6 }}>
              {result.error}
            </span>
          )}
          {counts && (
            <>
              <button
                type="button"
                onClick={() => setFilterKind('all')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: filterKind === 'all' ? 'color-mix(in oklab, var(--foreground) 20%, transparent)' : 'transparent',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                全部 ({counts.added + counts.removed + counts.changed + counts.unchanged})
              </button>
              <button
                type="button"
                onClick={() => setFilterKind('added')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: filterKind === 'added' ? 'rgba(34,197,94,0.25)' : 'transparent',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                仅右侧 +{counts.added}
              </button>
              <button
                type="button"
                onClick={() => setFilterKind('removed')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: filterKind === 'removed' ? 'rgba(239,68,68,0.25)' : 'transparent',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                仅左侧 −{counts.removed}
              </button>
              <button
                type="button"
                onClick={() => setFilterKind('changed')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: filterKind === 'changed' ? 'rgba(234,179,8,0.25)' : 'transparent',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                已修改 ~{counts.changed}
              </button>
              <button
                type="button"
                onClick={() => setFilterKind('unchanged')}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: 'none',
                  background: filterKind === 'unchanged' ? 'color-mix(in oklab, var(--foreground) 12%, transparent)' : 'transparent',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                相同 ✓{counts.unchanged}
              </button>
            </>
          )}
        </div>
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 12,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 13,
            lineHeight: 1.7,
          }}
        >
          {result?.ok === true && filteredItems.length === 0 && (
            <div style={{ opacity: 0.6 }}>没有符合筛选的项</div>
          )}
          {result?.ok === true &&
            filteredItems.map((item) => (
              <div
                key={item.path}
                style={{
                  marginBottom: 6,
                  padding: '6px 10px',
                  borderRadius: 4,
                  borderLeft: `3px solid ${
                    item.kind === 'added'
                      ? VSCODE_GREEN_BORDER
                      : item.kind === 'removed'
                        ? VSCODE_RED_BORDER
                        : item.kind === 'changed'
                          ? 'rgba(180, 180, 80, 0.7)'
                          : 'color-mix(in oklab, var(--foreground) 25%, transparent)'
                  }`,
                  /* VSCode Git 风格：整行红/绿底色标出“不同” */
                  background:
                    item.kind === 'added'
                      ? VSCODE_GREEN_BG
                      : item.kind === 'removed'
                        ? VSCODE_RED_BG
                        : item.kind === 'changed'
                          ? 'transparent'
                          : 'transparent',
                }}
              >
                <span style={{ fontWeight: 600, marginRight: 8 }}>{item.path}</span>
                {item.kind === 'added' && (
                  <span style={{ background: VSCODE_GREEN_BG, padding: '2px 6px', borderRadius: 4 }}>
                    + {formatValue(item.valueRight)}
                  </span>
                )}
                {item.kind === 'removed' && (
                  <span style={{ background: VSCODE_RED_BG, padding: '2px 6px', borderRadius: 4 }}>
                    − {formatValue(item.valueLeft)}
                  </span>
                )}
                {item.kind === 'changed' && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span
                      style={{
                        background: VSCODE_RED_BG,
                        padding: '2px 6px',
                        borderRadius: 4,
                        textDecoration: 'line-through',
                      }}
                    >
                      {formatValue(item.valueLeft)}
                    </span>
                    <span style={{ opacity: 0.7 }}>→</span>
                    <span
                      style={{
                        background: VSCODE_GREEN_BG,
                        padding: '2px 6px',
                        borderRadius: 4,
                      }}
                    >
                      {formatValue(item.valueRight)}
                    </span>
                  </span>
                )}
                {item.kind === 'unchanged' && <span style={{ opacity: 0.7 }}>{formatValue(item.valueLeft)}</span>}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
