// freetype-wasm 类型声明（薄包装层；原生层走 module 任意调用）

export interface FTConstants {
  LOAD_DEFAULT: number; LOAD_NO_SCALE: number; LOAD_NO_HINTING: number;
  LOAD_RENDER: number; LOAD_NO_BITMAP: number; LOAD_VERTICAL_LAYOUT: number;
  LOAD_FORCE_AUTOHINT: number; LOAD_CROP_BITMAP: number; LOAD_PEDANTIC: number;
  LOAD_ADVANCE_ONLY: number; LOAD_IGNORE_GLOBAL_ADVANCE_WIDTH: number;
  LOAD_NO_RECURSE: number; LOAD_IGNORE_TRANSFORM: number; LOAD_MONOCHROME: number;
  LOAD_LINEAR_DESIGN: number; LOAD_SBITS_ONLY: number; LOAD_NO_AUTOHINT: number;
  LOAD_COLOR: number; LOAD_COMPUTE_METRICS: number; LOAD_BITMAP_METRICS_ONLY: number;
  LOAD_SVG_ONLY: number; LOAD_NO_SVG: number;
  LOAD_TARGET_NORMAL: number; LOAD_TARGET_LIGHT: number; LOAD_TARGET_MONO: number;
  LOAD_TARGET_LCD: number; LOAD_TARGET_LCD_V: number; LOAD_TARGET_SDF: number;
  RENDER_MODE_NORMAL: number; RENDER_MODE_LIGHT: number; RENDER_MODE_MONO: number;
  RENDER_MODE_LCD: number; RENDER_MODE_LCD_V: number; RENDER_MODE_SDF: number;
  PIXEL_MODE_NONE: number; PIXEL_MODE_MONO: number; PIXEL_MODE_GRAY: number;
  PIXEL_MODE_GRAY2: number; PIXEL_MODE_GRAY4: number; PIXEL_MODE_LCD: number;
  PIXEL_MODE_LCD_V: number; PIXEL_MODE_BGRA: number;
  KERNING_DEFAULT: number; KERNING_UNFITTED: number; KERNING_UNSCALED: number;
  ENCODING_NONE: number; ENCODING_UNICODE: number; ENCODING_MS_SYMBOL: number;
  ENCODING_SJIS: number; ENCODING_PRC: number; ENCODING_BIG5: number;
  ENCODING_WANSUNG: number; ENCODING_JOHAB: number; ENCODING_ADOBE_STANDARD: number;
  ENCODING_ADOBE_EXPERT: number; ENCODING_ADOBE_CUSTOM: number;
  ENCODING_ADOBE_LATIN_1: number; ENCODING_OLD_LATIN_2: number; ENCODING_APPLE_ROMAN: number;
}
export const FT: FTConstants;

export interface GlyphMetrics {
  width: number; height: number;
  horiBearingX: number; horiBearingY: number; horiAdvance: number;
  vertBearingX: number; vertBearingY: number; vertAdvance: number;
}
export interface LoadedGlyph {
  width: number; rows: number; pitch: number;
  pixelMode: number; numGrays: number;
  bitmapLeft: number; bitmapTop: number;
  advance: { x: number; y: number };
  metrics: GlyphMetrics;
  /**
   * 已从 wasm 堆拷出。MONO: 1bpp、MSB 先；GRAY/SDF: 8bpp；
   * LCD/LCD_V: 每像素 3 个水平/垂直子像素；BGRA: 4 字节预乘颜色。
   * pitch < 0 时第 y 行从 (rows - 1 - y) * -pitch 开始，否则从 y * pitch 开始。
   */
  buffer: Uint8Array;
}
export interface FaceInfo {
  numFaces: number; numGlyphs: number;
  familyName: string; styleName: string;
  numFixedSizes: number; numCharmaps: number; unitsPerEM: number;
  ascender: number; descender: number; height: number;
}
export interface SizeMetrics {
  xPpem: number; yPpem: number;
  xScale: number; yScale: number;
  ascender: number; descender: number; height: number; maxAdvance: number;
}

export class Face {
  readonly ptr: number;
  /** 完整 Emscripten 模块（原生逃生口） */
  readonly module: any;
  info(): FaceInfo;
  sizeMetrics(): SizeMetrics;
  /** 设置像素高度；width=0 时由字体比例自动推导。 */
  setPixelSize(height: number, width?: number): this;
  /** 按 FreeType 原生顺序显式设置 width/height。 */
  setPixelSizes(width: number, height: number): this;
  selectSize(index: number): this;
  setCharSize(charW26_6: number, charH26_6: number, hdpi: number, vdpi: number): this;
  charIndex(codepoint: number): number;
  characters(): Generator<{ codepoint: number; glyphIndex: number }, void, void>;
  selectCharmap(encoding: number): this;
  loadGlyph(o?: {
    char?: number; index?: number; flags?: number;
    render?: boolean; renderMode?: number;
  }): LoadedGlyph;
  kerning(leftIndex: number, rightIndex: number, mode?: number): { x: number; y: number };
  destroy(): void;
}

export class FreeType {
  /** 完整 Emscripten 模块：ccall/cwrap/getValue/setValue/HEAPU8/_malloc/_free/addFunction… */
  readonly module: any;
  /** wasm32 结构体字段偏移（读 module 内存用） */
  readonly offsets: Record<string, any>;
  readonly library: number;
  version(): [number, number, number];
  errorString(code: number): string;
  newFace(bytes: Uint8Array | ArrayBuffer, faceIndex?: number): Face;
  destroy(): void;
}

export default function initFreeType(opts?: {
  wasmBinary?: Uint8Array;
  locateFile?: (path: string) => string;
}): Promise<FreeType>;
