'use client';

import { useEffect, useState } from 'react';

// 简单的 Markdown 渲染函数（不依赖外部库）
function renderMarkdown(md: string): string {
  if (!md.trim()) return '<p style="opacity: 0.5;">开始编写 Markdown...</p>';

  let html = md;

  // 转义 HTML 特殊字符（但保留代码块中的内容）
  const escapeHtml = (text: string) => {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // 先处理代码块（避免内部内容被其他规则处理）
  const codeBlocks: string[] = [];
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const id = `__CODE_BLOCK_${codeBlocks.length}__`;
    const escaped = escapeHtml(code.trim());
    codeBlocks.push(`<pre><code class="language-${lang || 'text'}">${escaped}</code></pre>`);
    return id;
  });

  // 行内代码（需要避免匹配代码块中的内容）
  html = html.replace(/`([^`\n]+)`/g, (match, code) => {
    if (match.includes('__CODE_BLOCK_')) return match;
    return `<code>${escapeHtml(code)}</code>`;
  });

  // 恢复代码块
  codeBlocks.forEach((block, idx) => {
    html = html.replace(`__CODE_BLOCK_${idx}__`, block);
  });

  // 水平线
  html = html.replace(/^---$/gim, '<hr />');
  html = html.replace(/^\*\*\*$/gim, '<hr />');

  // 标题（需要在段落处理之前）
  html = html.replace(/^###### (.*)$/gim, '<h6>$1</h6>');
  html = html.replace(/^##### (.*)$/gim, '<h5>$1</h5>');
  html = html.replace(/^#### (.*)$/gim, '<h4>$1</h4>');
  html = html.replace(/^### (.*)$/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*)$/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*)$/gim, '<h1>$1</h1>');

  // 引用块（多行）
  html = html.replace(/^(&gt;|>)(.*)$/gim, '<blockquote>$2</blockquote>');
  // 合并连续的 blockquote
  html = html.replace(/<\/blockquote>\s*<blockquote>/g, '<br />');

  // 列表处理（需要按行处理）
  const lines = html.split('\n');
  const processedLines: string[] = [];
  let inList = false;
  let listType = '';
  let listItems: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ulMatch = line.match(/^(\s*)[-*+] (.+)$/);
    const olMatch = line.match(/^(\s*)\d+\. (.+)$/);

    if (ulMatch || olMatch) {
      const match = ulMatch || olMatch!;
      const indent = match[1].length;
      const content = match[2];

      if (!inList || listType !== (ulMatch ? 'ul' : 'ol')) {
        if (inList) {
          processedLines.push(`<${listType}>${listItems.join('')}</${listType}>`);
        }
        listItems = [];
        listType = ulMatch ? 'ul' : 'ol';
        inList = true;
      }
      listItems.push(`<li>${content}</li>`);
    } else {
      if (inList) {
        processedLines.push(`<${listType}>${listItems.join('')}</${listType}>`);
        listItems = [];
        inList = false;
        listType = '';
      }
      processedLines.push(line);
    }
  }
  if (inList) {
    processedLines.push(`<${listType}>${listItems.join('')}</${listType}>`);
  }
  html = processedLines.join('\n');

  // 图片
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

  // 链接
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // 粗体和斜体（需要在链接之后，避免匹配链接中的括号）
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // 删除线
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // 处理段落（空行分隔）
  const paragraphs = html.split(/\n\s*\n/);
  html = paragraphs
    .map((para) => {
      const trimmed = para.trim();
      if (!trimmed) return '';
      // 如果已经是 HTML 标签（标题、列表、代码块等），不包装
      if (trimmed.startsWith('<') && (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<ol') || trimmed.startsWith('<pre') || trimmed.startsWith('<blockquote') || trimmed.startsWith('<hr'))) {
        return trimmed;
      }
      return `<p>${trimmed}</p>`;
    })
    .filter((p) => p)
    .join('\n');

  // 单行换行（两个空格 + 换行）
  html = html.replace(/  \n/g, '<br />\n');

  return html;
}

const STORAGE_KEY = 'markdown-editor-content';

export default function MarkdownEditorPage() {
  const [content, setContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  // 从 localStorage 恢复内容
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        setContent(saved);
      }
      setIsLoading(false);
    }
  }, []);

  // 实时保存到 localStorage
  useEffect(() => {
    if (!isLoading && typeof window !== 'undefined') {
      const timeoutId = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, content);
      }, 300); // 防抖：300ms 后保存

      return () => clearTimeout(timeoutId);
    }
  }, [content, isLoading]);

  // 下载为 .md 文件
  function downloadAsMarkdown() {
    if (!content.trim()) {
      alert('内容为空，无法下载');
      return;
    }

    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;

    // 生成文件名：markdown-YYYYMMDD-HHMMSS.md
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const filename = `markdown-${year}${month}${day}-${hours}${minutes}${seconds}.md`;

    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px' }}>
        <div style={{ opacity: 0.6 }}>加载中...</div>
      </div>
    );
  }

  const renderedHtml = renderMarkdown(content);

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 16px', height: 'calc(100vh - var(--app-header-h) - 48px)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>Markdown 编辑器</h1>
          <p style={{ opacity: 0.7, margin: 0, fontSize: 14 }}>
            实时预览，内容自动保存到本地存储
          </p>
        </div>
        <button
          onClick={downloadAsMarkdown}
          disabled={!content.trim()}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: '1px solid color-mix(in oklab, var(--foreground) 18%, transparent)',
            background: 'color-mix(in oklab, var(--foreground) 10%, transparent)',
            color: 'var(--foreground)',
            cursor: content.trim() ? 'pointer' : 'not-allowed',
            opacity: content.trim() ? 1 : 0.5,
            fontSize: 14,
            fontWeight: 500,
            transition: 'opacity 0.2s ease',
          }}
          onMouseEnter={(e) => {
            if (content.trim()) {
              e.currentTarget.style.opacity = '0.9';
              e.currentTarget.style.background = 'color-mix(in oklab, var(--foreground) 15%, transparent)';
            }
          }}
          onMouseLeave={(e) => {
            if (content.trim()) {
              e.currentTarget.style.opacity = '1';
              e.currentTarget.style.background = 'color-mix(in oklab, var(--foreground) 10%, transparent)';
            }
          }}
        >
          ⬇ 下载为 .md
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          height: 'calc(100% - 80px)',
          border: '1px solid color-mix(in oklab, var(--foreground) 16%, transparent)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {/* 编辑区 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid color-mix(in oklab, var(--foreground) 16%, transparent)',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid color-mix(in oklab, var(--foreground) 16%, transparent)',
              background: 'color-mix(in oklab, var(--background) 96%, var(--foreground))',
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            编辑
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="# 开始编写 Markdown&#10;&#10;支持标题、**粗体**、*斜体*、代码块、列表等..."
            spellCheck={false}
            style={{
              flex: 1,
              width: '100%',
              padding: 16,
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
              fontSize: 14,
              lineHeight: 1.6,
              background: 'transparent',
              color: 'var(--foreground)',
            }}
          />
        </div>

        {/* 预览区 */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            overflow: 'auto',
          }}
        >
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid color-mix(in oklab, var(--foreground) 16%, transparent)',
              background: 'color-mix(in oklab, var(--background) 96%, var(--foreground))',
              fontSize: 14,
              fontWeight: 500,
              position: 'sticky',
              top: 0,
              zIndex: 10,
            }}
          >
            预览
          </div>
          <div
            style={{
              flex: 1,
              padding: 24,
              overflow: 'auto',
              lineHeight: 1.8,
            }}
            className="markdown-preview"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        </div>
      </div>
    </div>
  );
}
