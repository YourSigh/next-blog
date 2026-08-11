declare module 'gifenc' {
  export type RGBPalette = number[][];

  export type QuantizeOptions = {
    format?: 'rgb565' | 'rgb444' | 'rgba4444';
    clearAlpha?: boolean;
    clearAlphaColor?: number;
    clearAlphaThreshold?: number;
    oneBitAlpha?: boolean | number;
    useSqrt?: boolean;
  };

  export type WriteFrameOptions = {
    palette?: RGBPalette;
    first?: boolean;
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number;
    repeat?: number;
    dispose?: number;
    colorDepth?: number;
  };

  export type GIFEncoderInstance = {
    reset(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: WriteFrameOptions,
    ): void;
  };

  export function GIFEncoder(opts?: {
    initialCapacity?: number;
    auto?: boolean;
  }): GIFEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: QuantizeOptions,
  ): RGBPalette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: RGBPalette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array;
}
