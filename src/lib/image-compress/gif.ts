import { parseGIF, decompressFrames, type ParsedFrame } from 'gifuct-js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import {
  calcTargetDimensions,
  qualityToGifColors,
  type CompressParams,
} from './types';

type DecodedFrame = {
  rgba: Uint8ClampedArray;
  delay: number;
};

type DecodedGif = {
  width: number;
  height: number;
  frames: DecodedFrame[];
};

function asUint8(data: Uint8ClampedArray): Uint8Array {
  return data instanceof Uint8Array
    ? data
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function decodeGifFrames(buffer: ArrayBuffer): DecodedGif {
  const parsed = parseGIF(buffer);
  const frames = decompressFrames(parsed, true);
  if (!frames.length) {
    throw new Error('无法解析 GIF 帧，文件可能已损坏');
  }

  const width = parsed.lsd.width;
  const height = parsed.lsd.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D 环境');

  const patchCanvas = document.createElement('canvas');
  const patchCtx = patchCanvas.getContext('2d');
  if (!patchCtx) throw new Error('当前浏览器不支持 Canvas 2D 环境');

  let previous: ImageData | null = null;
  const output: DecodedFrame[] = [];

  for (const frame of frames as ParsedFrame[]) {
    const { dims, patch, delay, disposalType } = frame;

    if (disposalType === 3) {
      previous = ctx.getImageData(0, 0, width, height);
    }

    patchCanvas.width = dims.width;
    patchCanvas.height = dims.height;
    const imageData = patchCtx.createImageData(dims.width, dims.height);
    imageData.data.set(patch);
    patchCtx.putImageData(imageData, 0, 0);
    ctx.drawImage(patchCanvas, dims.left, dims.top);

    const full = ctx.getImageData(0, 0, width, height);
    output.push({
      rgba: new Uint8ClampedArray(full.data),
      // gifuct-js 已转为 ms；0 按浏览器常见默认 100ms
      delay: delay > 0 ? delay : 100,
    });

    if (disposalType === 2) {
      ctx.clearRect(dims.left, dims.top, dims.width, dims.height);
    } else if (disposalType === 3 && previous) {
      ctx.putImageData(previous, 0, 0);
    }
  }

  return { width, height, frames: output };
}

function resizeRgba(
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  if (srcW === dstW && srcH === dstH) {
    return rgba;
  }

  const src = document.createElement('canvas');
  src.width = srcW;
  src.height = srcH;
  const sctx = src.getContext('2d');
  if (!sctx) throw new Error('当前浏览器不支持 Canvas 2D 环境');

  const imageData = sctx.createImageData(srcW, srcH);
  imageData.data.set(rgba);
  sctx.putImageData(imageData, 0, 0);

  const dst = document.createElement('canvas');
  dst.width = dstW;
  dst.height = dstH;
  const dctx = dst.getContext('2d');
  if (!dctx) throw new Error('当前浏览器不支持 Canvas 2D 环境');
  dctx.drawImage(src, 0, 0, dstW, dstH);
  return new Uint8ClampedArray(dctx.getImageData(0, 0, dstW, dstH).data);
}

function hasTransparency(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 128) return true;
  }
  return false;
}

function findTransparentIndex(palette: number[][]): number {
  for (let i = 0; i < palette.length; i++) {
    const color = palette[i];
    if ((color[3] ?? 255) < 128) return i;
  }
  return 0;
}

function encodeGifFrames(
  frames: DecodedFrame[],
  width: number,
  height: number,
  maxColors: number,
): Blob {
  const gif = GIFEncoder();
  const colors = Math.max(2, Math.min(256, maxColors));

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const data = asUint8(frame.rgba);
    const transparent = hasTransparency(frame.rgba);
    const format = transparent ? 'rgba4444' : 'rgb565';
    const palette = quantize(data, colors, {
      format,
      clearAlpha: transparent,
      clearAlphaThreshold: 127,
    });
    const index = applyPalette(data, palette, format);

    gif.writeFrame(index, width, height, {
      palette,
      delay: frame.delay,
      // 每帧是完整合成结果，不依赖上一帧
      dispose: 1,
      transparent,
      transparentIndex: transparent ? findTransparentIndex(palette) : 0,
      ...(i === 0 ? { repeat: 0 } : {}),
    });
  }

  gif.finish();
  return new Blob([gif.bytes() as BlobPart], { type: 'image/gif' });
}

function prepareFrames(
  decoded: DecodedGif,
  targetW: number,
  targetH: number,
): DecodedFrame[] {
  return decoded.frames.map((frame) => ({
    rgba: resizeRgba(frame.rgba, decoded.width, decoded.height, targetW, targetH),
    delay: frame.delay,
  }));
}

/**
 * 浏览器端压缩 GIF：保留动画帧，通过缩放 + 减色实现体积下降。
 * quality 映射为调色板颜色数；targetSizeKB 时对颜色数做二分逼近。
 */
export async function compressGifInBrowser(
  file: File,
  options: CompressParams,
): Promise<Blob> {
  const buffer = await file.arrayBuffer();
  const decoded = decodeGifFrames(buffer);
  const { width, height } = calcTargetDimensions(
    decoded.width,
    decoded.height,
    options,
  );

  const maxColors = qualityToGifColors(options.quality ?? 0.8);
  let frames = prepareFrames(decoded, width, height);
  let blob = encodeGifFrames(frames, width, height, maxColors);

  if (!options.targetSizeKB || options.targetSizeKB <= 0) {
    return blob;
  }

  const targetBytes = options.targetSizeKB * 1024;
  if (blob.size <= targetBytes) {
    return blob;
  }

  let low = 8;
  let high = maxColors;
  let best = blob;

  for (let i = 0; i < 6; i++) {
    const mid = Math.max(8, Math.round((low + high) / 2));
    const candidate = encodeGifFrames(frames, width, height, mid);

    if (candidate.size <= targetBytes) {
      best = candidate;
      low = mid + 1;
      if (Math.abs(candidate.size - targetBytes) < targetBytes * 0.1) {
        break;
      }
    } else {
      high = mid - 1;
      if (candidate.size < best.size) best = candidate;
    }

    if (low > high) break;
  }

  // 颜色已压到下限仍偏大时，再等比缩小尺寸一次
  if (best.size > targetBytes && (width > 32 || height > 32)) {
    const scale = Math.sqrt(targetBytes / best.size);
    const scaledW = Math.max(16, Math.round(width * Math.min(1, scale)));
    const scaledH = Math.max(16, Math.round(height * Math.min(1, scale)));
    if (scaledW < width || scaledH < height) {
      frames = prepareFrames(decoded, scaledW, scaledH);
      const retry = encodeGifFrames(frames, scaledW, scaledH, Math.min(32, maxColors));
      if (retry.size < best.size) best = retry;
    }
  }

  return best;
}
