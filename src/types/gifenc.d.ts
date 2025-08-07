declare module 'gifenc' {
  export function GIFEncoder(): {
    writeHeader(): void;
    setRepeat(repeat: number): void;
    setDelay(ms: number): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: { palette?: Uint8Array | Uint8ClampedArray; delay?: number; transparent?: number }
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  export function quantize(
    rgba: Uint8Array,
    maxColors?: number,
    options?: { format?: 'rgba4444' | 'rgba8888' }
  ): Uint8Array;
  export function applyPalette(
    rgba: Uint8Array,
    palette: Uint8Array | Uint8ClampedArray
  ): Uint8Array;
}

