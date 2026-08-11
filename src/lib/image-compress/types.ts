export type CompressParams = {
  width?: number;
  height?: number;
  /** 0–1；JPEG 为编码质量，GIF 映射为调色板颜色数 */
  quality?: number;
  targetSizeKB?: number;
};

export function isGifFile(file: File): boolean {
  return file.type === 'image/gif' || /\.gif$/i.test(file.name);
}

export function calcTargetDimensions(
  originW: number,
  originH: number,
  options: Pick<CompressParams, 'width' | 'height'>,
): { width: number; height: number } {
  let width = originW;
  let height = originH;

  if (options.width && options.height) {
    width = options.width;
    height = options.height;
  } else if (options.width) {
    width = options.width;
    height = Math.max(1, Math.round((originH / originW) * width));
  } else if (options.height) {
    height = options.height;
    width = Math.max(1, Math.round((originW / originH) * height));
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

/** GIF：质量 0–1 → 调色板颜色数 8–256 */
export function qualityToGifColors(quality = 0.8): number {
  const q = Math.min(1, Math.max(0, quality));
  return Math.max(8, Math.min(256, Math.round(8 + q * 248)));
}
