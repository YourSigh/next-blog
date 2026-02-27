import { NextResponse } from 'next/server';

type CompressParams = {
  /** 目标宽度，单位：像素，可选 */
  width?: number;
  /** 目标高度，单位：像素，可选 */
  height?: number;
  /** 目标文件大小，单位：KB，可选 */
  targetSizeKB?: number;
  /** 压缩质量，0-1，可选（主要给前端 canvas 使用） */
  quality?: number;
};

/**
 * 图片压缩路由（/api/image-compress）
 *
 * 说明：
 * - 不使用任何三方库，所以真正的像素级压缩建议放在前端通过 canvas 完成，
 *   本路由负责接收「已压缩」后的图片二进制和参数，做统一的校验 / 记录 / 转发。
 * - 前端可以：
 *   1. 先使用 <input type="file"> 选择图片
 *   2. 使用 canvas 根据 width/height/quality/targetSizeKB 做压缩
 *   3. 再把压缩后的 Blob 通过 multipart/form-data POST 到本接口
 */
export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') || '';

  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return NextResponse.json(
      {
        ok: false,
        message: '请使用 multipart/form-data 上传图片（字段名：file）',
      },
      { status: 400 },
    );
  }

  const formData = await request.formData();
  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json(
      {
        ok: false,
        message: '未找到文件字段 file，或类型不正确',
      },
      { status: 400 },
    );
  }

  const params: CompressParams = {};

  const widthRaw = formData.get('width');
  const heightRaw = formData.get('height');
  const targetSizeRaw = formData.get('targetSizeKB');
  const qualityRaw = formData.get('quality');

  if (typeof widthRaw === 'string' && widthRaw.trim() !== '') {
    const w = Number(widthRaw);
    if (!Number.isNaN(w) && w > 0) {
      params.width = w;
    }
  }

  if (typeof heightRaw === 'string' && heightRaw.trim() !== '') {
    const h = Number(heightRaw);
    if (!Number.isNaN(h) && h > 0) {
      params.height = h;
    }
  }

  if (typeof targetSizeRaw === 'string' && targetSizeRaw.trim() !== '') {
    const s = Number(targetSizeRaw);
    if (!Number.isNaN(s) && s > 0) {
      params.targetSizeKB = s;
    }
  }

  if (typeof qualityRaw === 'string' && qualityRaw.trim() !== '') {
    const q = Number(qualityRaw);
    if (!Number.isNaN(q) && q >= 0 && q <= 1) {
      params.quality = q;
    }
  }

  const arrayBuffer = await file.arrayBuffer();
  const originalSize = arrayBuffer.byteLength;

  // 这里不做真正的「二进制重编码压缩」，因为不使用三方库在 Node 侧实现
  // JPEG/PNG/WebP 编解码非常复杂。
  //
  // 推荐方案：
  // - 前端使用 canvas 把图片按 width/height/quality/targetSizeKB 做压缩
  // - 再把压缩后的 Blob 通过本接口上传
  //
  // 本接口返回：
  // - 文件原始字节长度（即当前上传的大小）
  // - 调用方提供的压缩参数
  // - 原样二进制文件（方便你直接保存 / 转发）

  const headers = new Headers();
  headers.set('Content-Type', file.type || 'application/octet-stream');
  headers.set(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(file.name || 'compressed-image')}"`,
  );

  headers.set(
    'X-Image-Meta',
    JSON.stringify({
      originalSizeBytes: originalSize,
      originalSizeKB: Number((originalSize / 1024).toFixed(2)),
      params,
    }),
  );

  return new Response(arrayBuffer, {
    status: 200,
    headers,
  });
}

