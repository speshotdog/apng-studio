declare module 'sql.js' {
  export interface QueryExecResult {
    columns: string[]
    values: unknown[][]
  }
  export class Database {
    constructor(data?: ArrayLike<number>)
    exec(sql: string): QueryExecResult[]
    close(): void
  }
  interface SqlJsStatic {
    Database: typeof Database
  }
  export default function initSqlJs(config?: {
    wasmBinary?: ArrayLike<number>
  }): Promise<SqlJsStatic>
}

declare module 'upng-js' {
  interface DecodedImage {
    width: number
    height: number
  }
  const UPNG: {
    decode(buffer: ArrayBuffer): DecodedImage
    toRGBA8(image: DecodedImage): ArrayBuffer[]
    encode(buffers: ArrayBuffer[], width: number, height: number, colors: number): ArrayBuffer
  }
  export default UPNG
}

declare module 'gifenc' {
  type Palette = number[][]
  interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: {
        palette: Palette
        delay?: number
        repeat?: number
        transparent?: boolean
        transparentIndex?: number
      },
    ): void
    finish(): void
    bytes(): Uint8Array
  }
  export function GIFEncoder(options?: {
    auto?: boolean
    initialCapacity?: number
  }): GifEncoderInstance
  export function quantize(
    rgba: Uint8Array,
    maxColors: number,
    options?: {
      format?: 'rgb565' | 'rgb444' | 'rgba4444'
      oneBitAlpha?: boolean | number
    },
  ): Palette
  export function applyPalette(
    rgba: Uint8Array,
    palette: Palette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444',
  ): Uint8Array
  const gifenc: {
    GIFEncoder: typeof GIFEncoder
    quantize: typeof quantize
    applyPalette: typeof applyPalette
  }
  export default gifenc
}

declare module '*.css'
