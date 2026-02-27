'use client';

import { useEffect, useMemo, useState } from 'react';

type CompressParams = {
  width?: number;
  height?: number;
  quality?: number;
  targetSizeKB?: number;
};

type PreviewInfo = {
  url: string;
  sizeKB: number;
};

async function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

async function compressImageInBrowser(file: File, options: CompressParams): Promise<Blob> {
  const img = await fileToImage(file);

  const originW = img.width;
  const originH = img.height;

  let targetW = originW;
  let targetH = originH;

  if (options.width && options.height) {
    targetW = options.width;
    targetH = options.height;
  } else if (options.width) {
    targetW = options.width;
    targetH = Math.round((originH / originW) * targetW);
  } else if (options.height) {
    targetH = options.height;
    targetW = Math.round((originW / originH) * targetH);
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D 环境');

  ctx.drawImage(img, 0, 0, targetW, targetH);

  const quality = options.quality ?? 0.8;

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('canvas.toBlob 失败'));
      },
      'image/jpeg',
      quality,
    );
  });

  return blob;
}

function formatSizeKB(size: number | undefined): string {
  if (size == null || Number.isNaN(size)) return '-';
  return `${size.toFixed(2)} KB`;
}

export default function ImageCompressPage() {
  const [file, setFile] = useState<File | null>(null);
  const [originPreview, setOriginPreview] = useState<PreviewInfo | null>(null);
  const [compressedPreview, setCompressedPreview] = useState<PreviewInfo | null>(null);

  const [width, setWidth] = useState<string>('');
  const [height, setHeight] = useState<string>('');
  const [quality, setQuality] = useState<string>('0.8');
  const [targetSizeKB, setTargetSizeKB] = useState<string>('');

  const [isCompressing, setIsCompressing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<any | null>(null);

  useEffect(() => {
    return () => {
      if (originPreview?.url) URL.revokeObjectURL(originPreview.url);
      if (compressedPreview?.url) URL.revokeObjectURL(compressedPreview.url);
    };
  }, [originPreview?.url, compressedPreview?.url]);

  const disabled = useMemo(() => !file || isCompressing, [file, isCompressing]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;

    setError(null);
    setMeta(null);
    setCompressedPreview(null);

    if (originPreview?.url) URL.revokeObjectURL(originPreview.url);

    const sizeKB = f.size / 1024;
    const url = URL.createObjectURL(f);
    setFile(f);
    setOriginPreview({ url, sizeKB });
  }

  async function handleCompress() {
    if (!file) return;
    setIsCompressing(true);
    setError(null);
    setMeta(null);

    try {
      const params: CompressParams = {};
      const w = Number(width);
      const h = Number(height);
      const q = Number(quality);
      const t = Number(targetSizeKB);

      if (!Number.isNaN(w) && w > 0) params.width = w;
      if (!Number.isNaN(h) && h > 0) params.height = h;
      if (!Number.isNaN(q) && q >= 0 && q <= 1) params.quality = q;
      if (!Number.isNaN(t) && t > 0) params.targetSizeKB = t;

      let compressedBlob = await compressImageInBrowser(file, params);

      if (params.targetSizeKB && !Number.isNaN(params.targetSizeKB)) {
        let low = 0.1;
        let high = params.quality ?? 0.9;
        let bestBlob = compressedBlob;
        const targetBytes = params.targetSizeKB * 1024;

        for (let i = 0; i < 5; i++) {
          const currentSize = compressedBlob.size;
          if (Math.abs(currentSize - targetBytes) < targetBytes * 0.1) {
            bestBlob = compressedBlob;
            break;
          }

          const mid = (low + high) / 2;

          const tmpBlob: Blob = await new Promise((resolve, reject) => {
            const imgPromise = fileToImage(file);
            imgPromise
              .then((img) => {
                const canvas = document.createElement('canvas');
                const originW = img.width;
                const originH = img.height;

                let targetW = originW;
                let targetH = originH;

                if (params.width && params.height) {
                  targetW = params.width;
                  targetH = params.height;
                } else if (params.width) {
                  targetW = params.width;
                  targetH = Math.round((originH / originW) * targetW);
                } else if (params.height) {
                  targetH = params.height;
                  targetW = Math.round((originW / originH) * targetH);
                }

                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                  reject(new Error('Canvas 2D 不可用'));
                  return;
                }
                ctx.drawImage(img, 0, 0, targetW, targetH);

                canvas.toBlob(
                  (b) => {
                    if (b) resolve(b);
                    else reject(new Error('canvas.toBlob 失败'));
                  },
                  'image/jpeg',
                  mid,
                );
              })
              .catch(reject);
          });

          compressedBlob = tmpBlob;
          bestBlob = tmpBlob;

          if (compressedBlob.size > targetBytes) {
            high = mid;
          } else {
            low = mid;
          }
        }

        compressedBlob = bestBlob;
      }

      const formData = new FormData();
      const filename = file.name || 'image.jpg';
      formData.append('file', compressedBlob, filename);
      if (params.width) formData.append('width', String(params.width));
      if (params.height) formData.append('height', String(params.height));
      if (params.quality != null) formData.append('quality', String(params.quality));
      if (params.targetSizeKB) formData.append('targetSizeKB', String(params.targetSizeKB));

      const res = await fetch('/api/image-compress', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || `压缩接口返回错误：${res.status}`);
      }

      const resultBlob = await res.blob();
      const url = URL.createObjectURL(resultBlob);
      const sizeKB = resultBlob.size / 1024;

      if (compressedPreview?.url) URL.revokeObjectURL(compressedPreview.url);
      setCompressedPreview({ url, sizeKB });

      const metaHeader = res.headers.get('X-Image-Meta');
      if (metaHeader) {
        try {
          setMeta(JSON.parse(metaHeader));
        } catch {
          setMeta(null);
        }
      }
    } catch (err: any) {
      setError(err?.message || '压缩失败，请稍后重试');
    } finally {
      setIsCompressing(false);
    }
  }

  function handleDownloadCompressed() {
    if (!compressedPreview) return;

    const link = document.createElement('a');
    link.href = compressedPreview.url;

    const defaultName = file?.name || 'image.jpg';
    const dotIndex = defaultName.lastIndexOf('.');
    const downloadName =
      dotIndex > 0
        ? `${defaultName.slice(0, dotIndex)}-compressed${defaultName.slice(dotIndex)}`
        : `${defaultName}-compressed`;

    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: '0 auto',
        padding: '24px 16px',
        minHeight: 'calc(100vh - var(--app-header-h) - 48px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>图片压缩工具</h1>
        </div>
        <label
          style={{
            padding: '8px 16px',
            borderRadius: 999,
            border: '1px solid color-mix(in oklab, var(--foreground) 20%, transparent)',
            background: 'color-mix(in oklab, var(--foreground) 8%, transparent)',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          选择图片
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1.2fr)',
          gap: 20,
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            padding: 16,
            borderRadius: 12,
            border: '1px solid color-mix(in oklab, var(--foreground) 12%, transparent)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <h2 style={{ fontSize: 18, margin: 0 }}>压缩参数</h2>
          <p style={{ opacity: 0.7, fontSize: 13, margin: 0 }}>
            宽高可只填一个自动等比，质量 0–1，目标大小为尽量逼近值。
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 12,
              marginTop: 8,
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 13 }}>目标宽度（px）</label>
              <input
                type="number"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                placeholder="不填则自动"
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in oklab, var(--foreground) 20%, transparent)',
                  background: 'transparent',
                  color: 'var(--foreground)',
                  fontSize: 13,
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 13 }}>目标高度（px）</label>
              <input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                placeholder="不填则等比"
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in oklab, var(--foreground) 20%, transparent)',
                  background: 'transparent',
                  color: 'var(--foreground)',
                  fontSize: 13,
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 13 }}>质量（0–1）</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                placeholder="0.8"
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in oklab, var(--foreground) 20%, transparent)',
                  background: 'transparent',
                  color: 'var(--foreground)',
                  fontSize: 13,
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 13 }}>目标大小（KB）</label>
              <input
                type="number"
                min={1}
                value={targetSizeKB}
                onChange={(e) => setTargetSizeKB(e.target.value)}
                placeholder="例如 200"
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid color-mix(in oklab, var(--foreground) 20%, transparent)',
                  background: 'transparent',
                  color: 'var(--foreground)',
                  fontSize: 13,
                }}
              />
            </div>
          </div>

          <button
            disabled={disabled}
            onClick={handleCompress}
            style={{
              marginTop: 12,
              padding: '8px 14px',
              borderRadius: 10,
              border: 'none',
              background: disabled
                ? 'color-mix(in oklab, var(--foreground) 8%, transparent)'
                : 'color-mix(in oklab, var(--foreground) 24%, transparent)',
              color: 'var(--foreground)',
              fontSize: 14,
              fontWeight: 500,
              cursor: disabled ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {isCompressing ? '压缩中…' : '开始压缩'}
          </button>

          {error && (
            <div
              style={{
                marginTop: 8,
                fontSize: 13,
                color: 'var(--foreground)',
                borderRadius: 8,
                padding: '6px 8px',
                background: 'color-mix(in oklab, var(--foreground) 8%, transparent)',
              }}
            >
              {error}
            </div>
          )}

          {meta && (
            <div
              style={{
                marginTop: 10,
                fontSize: 12,
                opacity: 0.8,
                padding: '6px 8px',
                borderRadius: 8,
                border: '1px dashed color-mix(in oklab, var(--foreground) 16%, transparent)',
              }}
            >
              <div>服务端返回元信息：</div>
              <div style={{ marginTop: 4 }}>
                原始大小：{formatSizeKB(meta?.originalSizeKB)}（来自 /api/image-compress）
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 12,
          }}
        >
          <div
            style={{
              borderRadius: 12,
              border: '1px solid color-mix(in oklab, var(--foreground) 12%, transparent)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 13,
              }}
            >
              <span>原图预览</span>
              <span style={{ opacity: 0.7 }}>
                大小：{originPreview ? formatSizeKB(originPreview.sizeKB) : '-'}
              </span>
            </div>
            <div
              style={{
                flex: 1,
                borderRadius: 8,
                border: '1px dashed color-mix(in oklab, var(--foreground) 14%, transparent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                background:
                  'repeating-conic-gradient(from 45deg, color-mix(in oklab, var(--background) 96%, var(--foreground)) 0 25%, transparent 0 50%) 50% / 16px 16px',
              }}
            >
              {originPreview ? (
                <img
                  src={originPreview.url}
                  alt="original"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              ) : (
                <span style={{ fontSize: 13, opacity: 0.6 }}>请选择一张图片</span>
              )}
            </div>
          </div>

          <div
            style={{
              borderRadius: 12,
              border: '1px solid color-mix(in oklab, var(--foreground) 12%, transparent)',
              padding: 10,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 13,
              }}
            >
              <span>压缩后预览</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ opacity: 0.7 }}>
                  大小：{compressedPreview ? formatSizeKB(compressedPreview.sizeKB) : '-'}
                </span>
                <button
                  type="button"
                  disabled={!compressedPreview}
                  onClick={handleDownloadCompressed}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: '1px solid color-mix(in oklab, var(--foreground) 20%, transparent)',
                    background: compressedPreview
                      ? 'color-mix(in oklab, var(--foreground) 14%, transparent)'
                      : 'transparent',
                    color: 'var(--foreground)',
                    fontSize: 12,
                    cursor: compressedPreview ? 'pointer' : 'not-allowed',
                    opacity: compressedPreview ? 1 : 0.5,
                  }}
                >
                  下载压缩图
                </button>
              </div>
            </div>
            <div
              style={{
                flex: 1,
                borderRadius: 8,
                border: '1px dashed color-mix(in oklab, var(--foreground) 14%, transparent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                background:
                  'repeating-conic-gradient(from 45deg, color-mix(in oklab, var(--background) 96%, var(--foreground)) 0 25%, transparent 0 50%) 50% / 16px 16px',
              }}
            >
              {compressedPreview ? (
                <img
                  src={compressedPreview.url}
                  alt="compressed"
                  style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                />
              ) : (
                <span style={{ fontSize: 13, opacity: 0.6 }}>
                  压缩结果会显示在这里
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

