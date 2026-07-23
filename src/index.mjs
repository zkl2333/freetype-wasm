/**
 * freetype-wasm —— 通用 FreeType 的薄 JS 包装。
 *
 * 两层用法：
 *  1) 便捷层：FreeType / Face 类，覆盖 90% 场景（开字体 → 设字号 → 渲字 → 取位图/度量）。
 *     MONO 还是灰度 AA 由调用方传 load flags 决定，本库不替你选。
 *  2) 原生层：`ft.module` 是完整 Emscripten 模块——`ccall/cwrap/getValue/setValue/
 *     HEAPU8/_malloc/_free/addFunction` 直达 *任意* FreeType 公共 C 函数。便捷层没包到的
 *     高级用法（outline 抽取、size 管理、模块属性…）走这里，配 `ft.offsets` 读结构体。
 *
 * 产物同目录需有：freetype.mjs / freetype.wasm / offsets.mjs（build.sh 产出）。
 */
import OFFSETS from "./offsets.mjs";

// 常用常量（FreeType 公开头里的值，稳定不变；要别的自己加）
export const FT = {
  // FT_LOAD_*
  LOAD_DEFAULT: 0x0,
  LOAD_NO_SCALE: 0x1,
  LOAD_NO_HINTING: 0x2,
  LOAD_RENDER: 0x4,
  LOAD_NO_BITMAP: 0x8,
  LOAD_VERTICAL_LAYOUT: 0x10,
  LOAD_FORCE_AUTOHINT: 0x20,
  LOAD_CROP_BITMAP: 0x40,
  LOAD_PEDANTIC: 0x80,
  LOAD_ADVANCE_ONLY: 0x100,
  LOAD_IGNORE_GLOBAL_ADVANCE_WIDTH: 0x200,
  LOAD_NO_RECURSE: 0x400,
  LOAD_IGNORE_TRANSFORM: 0x800,
  LOAD_MONOCHROME: 0x1000,
  LOAD_LINEAR_DESIGN: 0x2000,
  LOAD_SBITS_ONLY: 0x4000,
  LOAD_NO_AUTOHINT: 0x8000,
  LOAD_COLOR: 0x100000,
  LOAD_COMPUTE_METRICS: 0x200000,
  LOAD_BITMAP_METRICS_ONLY: 0x400000,
  LOAD_SVG_ONLY: 0x800000,
  LOAD_NO_SVG: 0x1000000,
  LOAD_TARGET_NORMAL: 0x0, // (FT_RENDER_MODE_NORMAL << 16)
  LOAD_TARGET_LIGHT: 0x10000, // (1<<16)
  LOAD_TARGET_MONO: 0x20000, // (2<<16)
  LOAD_TARGET_LCD: 0x30000, // (3<<16)
  LOAD_TARGET_LCD_V: 0x40000, // (4<<16)
  LOAD_TARGET_SDF: 0x50000, // (5<<16)
  // FT_RENDER_MODE_*
  RENDER_MODE_NORMAL: 0,
  RENDER_MODE_LIGHT: 1,
  RENDER_MODE_MONO: 2,
  RENDER_MODE_LCD: 3,
  RENDER_MODE_LCD_V: 4,
  RENDER_MODE_SDF: 5,
  // FT_PIXEL_MODE_*
  PIXEL_MODE_NONE: 0,
  PIXEL_MODE_MONO: 1,
  PIXEL_MODE_GRAY: 2,
  PIXEL_MODE_GRAY2: 3,
  PIXEL_MODE_GRAY4: 4,
  PIXEL_MODE_LCD: 5,
  PIXEL_MODE_LCD_V: 6,
  PIXEL_MODE_BGRA: 7,
  // FT_KERNING_*
  KERNING_DEFAULT: 0,
  KERNING_UNFITTED: 1,
  KERNING_UNSCALED: 2,
  // FT_ENCODING_*（4 字节 tag）
  ENCODING_NONE: 0,
  ENCODING_UNICODE: tag("unic"),
  ENCODING_MS_SYMBOL: tag("symb"),
  ENCODING_SJIS: tag("sjis"),
  ENCODING_PRC: tag("gb  "),
  ENCODING_BIG5: tag("big5"),
  ENCODING_WANSUNG: tag("wans"),
  ENCODING_JOHAB: tag("joha"),
  ENCODING_ADOBE_STANDARD: tag("ADOB"),
  ENCODING_ADOBE_EXPERT: tag("ADBE"),
  ENCODING_ADOBE_CUSTOM: tag("ADBC"),
  ENCODING_ADOBE_LATIN_1: tag("lat1"),
  ENCODING_OLD_LATIN_2: tag("lat2"),
  ENCODING_APPLE_ROMAN: tag("armn"),
};
function tag(s) {
  return (
    ((s.charCodeAt(0) & 0xff) << 24) |
    ((s.charCodeAt(1) & 0xff) << 16) |
    ((s.charCodeAt(2) & 0xff) << 8) |
    (s.charCodeAt(3) & 0xff)
  ) >>> 0;
}

// wasm32：long / FT_Pos / FT_Fixed / int / 指针都是 4 字节
const I32 = "i32";

let _factory; // 缓存动态 import

/**
 * @param {{wasmBinary?:Uint8Array, locateFile?:(p:string)=>string}} [opts]
 * @returns {Promise<FreeType>}
 */
export default async function initFreeType(opts = {}) {
  if (!_factory) _factory = (await import("./freetype.mjs")).default;
  const mod = await _factory({
    ...(opts.wasmBinary ? { wasmBinary: opts.wasmBinary } : {}),
    ...(opts.locateFile ? { locateFile: opts.locateFile } : {}),
  });
  return new FreeType(mod);
}

export class FreeType {
  constructor(mod) {
    this.module = mod; // 原生逃生口：完整 Emscripten 模块
    this.offsets = OFFSETS;
    this._faces = new Set();
    const c = (n, ret, a) => mod.cwrap(n, ret, a);
    this._fn = {
      InitFreeType: c("FT_Init_FreeType", "number", ["number"]),
      DoneFreeType: c("FT_Done_FreeType", "number", ["number"]),
      LibraryVersion: c("FT_Library_Version", null, ["number", "number", "number", "number"]),
      NewMemoryFace: c("FT_New_Memory_Face", "number", ["number", "number", "number", "number", "number"]),
      DoneFace: c("FT_Done_Face", "number", ["number"]),
      SetPixelSizes: c("FT_Set_Pixel_Sizes", "number", ["number", "number", "number"]),
      SetCharSize: c("FT_Set_Char_Size", "number", ["number", "number", "number", "number", "number"]),
      SelectSize: c("FT_Select_Size", "number", ["number", "number"]),
      GetCharIndex: c("FT_Get_Char_Index", "number", ["number", "number"]),
      GetFirstChar: c("FT_Get_First_Char", "number", ["number", "number"]),
      GetNextChar: c("FT_Get_Next_Char", "number", ["number", "number", "number"]),
      LoadGlyph: c("FT_Load_Glyph", "number", ["number", "number", "number"]),
      LoadChar: c("FT_Load_Char", "number", ["number", "number", "number"]),
      RenderGlyph: c("FT_Render_Glyph", "number", ["number", "number"]),
      GetKerning: c("FT_Get_Kerning", "number", ["number", "number", "number", "number", "number"]),
      SelectCharmap: c("FT_Select_Charmap", "number", ["number", "number"]),
      ErrorString: c("FT_Error_String", "string", ["number"]),
    };
    const libPP = mod._malloc(4);
    const err = this._fn.InitFreeType(libPP);
    if (err) {
      mod._free(libPP);
      throw this.error("FT_Init_FreeType", err);
    }
    this.library = mod.getValue(libPP, I32);
    mod._free(libPP);
  }

  /** FreeType 版本 [major,minor,patch] */
  version() {
    this._assertAlive();
    const m = this.module;
    const p = m._malloc(12);
    this._fn.LibraryVersion(this.library, p, p + 4, p + 8);
    const v = [m.getValue(p, I32), m.getValue(p + 4, I32), m.getValue(p + 8, I32)];
    m._free(p);
    return v;
  }

  /** 返回 FreeType 错误码的可读描述（构建时已启用错误字符串）。 */
  errorString(code) {
    return this._fn.ErrorString(code) || `Unknown error ${code}`;
  }

  /** @internal */
  error(operation, code) {
    return new Error(`${operation} 失败: ${this.errorString(code)} (${code})`);
  }

  /** @internal */
  _assertAlive() {
    if (!this.library) throw new Error("FreeType 实例已销毁");
  }

  /** 从字体字节建 Face（TTF/OTF/TTC/WOFF/WOFF2/Type1/CFF；WOFF2 已编入 brotli） */
  newFace(bytes, faceIndex = 0) {
    this._assertAlive();
    const m = this.module;
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const dataPtr = m._malloc(u8.length);
    m.HEAPU8.set(u8, dataPtr);
    const facePP = m._malloc(4);
    const err = this._fn.NewMemoryFace(this.library, dataPtr, u8.length, faceIndex, facePP);
    const facePtr = m.getValue(facePP, I32);
    m._free(facePP);
    if (err) {
      m._free(dataPtr);
      throw this.error("FT_New_Memory_Face", err);
    }
    const face = new Face(this, facePtr, dataPtr); // FT 不复制字体字节，dataPtr 须随 Face 存活
    this._faces.add(face);
    return face;
  }

  destroy() {
    if (!this.library) return;
    for (const face of [...this._faces]) face.destroy();
    this._fn.DoneFreeType(this.library);
    this.library = 0;
    this._faces.clear();
  }
}

export class Face {
  constructor(ft, facePtr, dataPtr) {
    this.ft = ft;
    this.module = ft.module;
    this.ptr = facePtr;
    this._dataPtr = dataPtr;
    this._O = ft.offsets;
  }

  _assertAlive() {
    if (!this.ptr) throw new Error("Face 实例已销毁");
    this.ft._assertAlive();
  }

  _faceField(name, type = I32) {
    this._assertAlive();
    return this.module.getValue(this.ptr + this._O.FT_FaceRec[name], type);
  }
  _str(name) {
    const p = this._faceField(name);
    return p ? this.module.UTF8ToString(p) : "";
  }

  info() {
    return {
      numFaces: this._faceField("num_faces"),
      numGlyphs: this._faceField("num_glyphs"),
      familyName: this._str("family_name"),
      styleName: this._str("style_name"),
      numFixedSizes: this._faceField("num_fixed_sizes"),
      numCharmaps: this._faceField("num_charmaps"),
      unitsPerEM: this.module.getValue(this.ptr + this._O.FT_FaceRec.units_per_EM, "i16") & 0xffff,
      ascender: this.module.getValue(this.ptr + this._O.FT_FaceRec.ascender, "i16"),
      descender: this.module.getValue(this.ptr + this._O.FT_FaceRec.descender, "i16"),
      height: this.module.getValue(this.ptr + this._O.FT_FaceRec.height, "i16"),
    };
  }

  /** 当前 size 的 ppem、缩放比与 26.6 定点度量。需先调用 setPixelSize/setCharSize。 */
  sizeMetrics() {
    const m = this.module;
    const size = this._faceField("size");
    if (!size) throw new Error("Face 当前没有可用的 FT_Size");
    const metrics = size + this._O.FT_SizeRec.metrics;
    const O = this._O.FT_Size_Metrics;
    return {
      xPpem: m.getValue(metrics + O.x_ppem, "i16") & 0xffff,
      yPpem: m.getValue(metrics + O.y_ppem, "i16") & 0xffff,
      xScale: m.getValue(metrics + O.x_scale, I32) >>> 0,
      yScale: m.getValue(metrics + O.y_scale, I32) >>> 0,
      ascender: m.getValue(metrics + O.ascender, I32),
      descender: m.getValue(metrics + O.descender, I32),
      height: m.getValue(metrics + O.height, I32),
      maxAdvance: m.getValue(metrics + O.max_advance, I32),
    };
  }

  /** 设置像素高度；width=0 时由字体比例自动推导（保留原有单参数便捷语义）。 */
  setPixelSize(height, width = 0) {
    this._assertAlive();
    const e = this.ft._fn.SetPixelSizes(this.ptr, width, height);
    if (e) throw this.ft.error("FT_Set_Pixel_Sizes", e);
    return this;
  }
  /** 按 FreeType 原生顺序显式设置 width/height 像素尺寸。 */
  setPixelSizes(width, height) {
    this._assertAlive();
    const e = this.ft._fn.SetPixelSizes(this.ptr, width, height);
    if (e) throw this.ft.error("FT_Set_Pixel_Sizes", e);
    return this;
  }
  /** 选择 bitmap-only 字体的固定 strike（index 可从 info().numFixedSizes 得到数量）。 */
  selectSize(index) {
    this._assertAlive();
    const e = this.ft._fn.SelectSize(this.ptr, index | 0);
    if (e) throw this.ft.error("FT_Select_Size", e);
    return this;
  }
  setCharSize(charW26_6, charH26_6, hdpi, vdpi) {
    this._assertAlive();
    const e = this.ft._fn.SetCharSize(this.ptr, charW26_6, charH26_6, hdpi, vdpi);
    if (e) throw this.ft.error("FT_Set_Char_Size", e);
    return this;
  }
  charIndex(codepoint) {
    this._assertAlive();
    return this.ft._fn.GetCharIndex(this.ptr, codepoint >>> 0);
  }

  /** 按码点升序遍历当前 charmap 中的字符与 glyph index。 */
  *characters() {
    this._assertAlive();
    const m = this.module;
    const glyphIndexP = m._malloc(4);
    try {
      let codepoint = this.ft._fn.GetFirstChar(this.ptr, glyphIndexP) >>> 0;
      let glyphIndex = m.getValue(glyphIndexP, I32) >>> 0;
      while (glyphIndex !== 0) {
        yield { codepoint, glyphIndex };
        this._assertAlive();
        codepoint = this.ft._fn.GetNextChar(this.ptr, codepoint, glyphIndexP) >>> 0;
        glyphIndex = m.getValue(glyphIndexP, I32) >>> 0;
      }
    } finally {
      m._free(glyphIndexP);
    }
  }

  selectCharmap(encoding) {
    this._assertAlive();
    const e = this.ft._fn.SelectCharmap(this.ptr, encoding >>> 0);
    if (e) throw this.ft.error("FT_Select_Charmap", e);
    return this;
  }

  /**
   * 渲一个字形。
   * @param {{char?:number, index?:number, flags?:number, render?:boolean, renderMode?:number}} o
   *   char: unicode 码点 | index: 直接给 glyph index；flags 默认 LOAD_DEFAULT；
   *   render 默认 true（用 renderMode，默认 NORMAL=灰度 AA；要 1-bit 传 FT.RENDER_MODE_MONO）
   * @returns {{width,rows,pitch,pixelMode,numGrays,bitmapLeft,bitmapTop,advance,
   *            metrics, buffer:Uint8Array}}  buffer 已从 wasm 堆拷出（安全持有）
   */
  loadGlyph(o = {}) {
    this._assertAlive();
    const m = this.module;
    const O = this._O;
    const flags = o.flags ?? FT.LOAD_DEFAULT;
    let e;
    if (o.index != null) e = this.ft._fn.LoadGlyph(this.ptr, o.index >>> 0, flags);
    else e = this.ft._fn.LoadChar(this.ptr, (o.char ?? 0) >>> 0, flags);
    if (e) throw this.ft.error(`FT_Load_${o.index != null ? "Glyph" : "Char"}`, e);

    const slot = this._faceField("glyph"); // FT_GlyphSlotRec*
    if (o.render !== false && !(flags & FT.LOAD_RENDER)) {
      e = this.ft._fn.RenderGlyph(slot, o.renderMode ?? FT.RENDER_MODE_NORMAL);
      if (e) throw this.ft.error("FT_Render_Glyph", e);
    }

    const bmp = slot + O.FT_GlyphSlotRec.bitmap;
    const B = O.FT_Bitmap;
    const rows = m.getValue(bmp + B.rows, I32) >>> 0;
    const width = m.getValue(bmp + B.width, I32) >>> 0;
    const pitch = m.getValue(bmp + B.pitch, I32); // 有符号，可能为负（自下而上）
    const bufPtr = m.getValue(bmp + B.buffer, I32);
    const pixelMode = m.getValue(bmp + B.pixel_mode, "i8") & 0xff;
    const numGrays = m.getValue(bmp + B.num_grays, "i16") & 0xffff;
    const nbytes = Math.abs(pitch) * rows;
    const bufferStart = pitch < 0 ? bufPtr + pitch * (rows - 1) : bufPtr;
    const buffer = nbytes > 0 ? m.HEAPU8.slice(bufferStart, bufferStart + nbytes) : new Uint8Array(0);

    const mp = slot + O.FT_GlyphSlotRec.metrics;
    const GM = O.FT_Glyph_Metrics;
    const g = (off) => m.getValue(mp + off, I32);
    const adv = slot + O.FT_GlyphSlotRec.advance;
    return {
      width,
      rows,
      pitch,
      pixelMode,
      numGrays,
      bitmapLeft: m.getValue(slot + O.FT_GlyphSlotRec.bitmap_left, I32),
      bitmapTop: m.getValue(slot + O.FT_GlyphSlotRec.bitmap_top, I32),
      advance: {
        x: m.getValue(adv + O.FT_Vector.x, I32), // 26.6 定点
        y: m.getValue(adv + O.FT_Vector.y, I32),
      },
      metrics: {
        width: g(GM.width),
        height: g(GM.height),
        horiBearingX: g(GM.horiBearingX),
        horiBearingY: g(GM.horiBearingY),
        horiAdvance: g(GM.horiAdvance), // 26.6
        vertBearingX: g(GM.vertBearingX),
        vertBearingY: g(GM.vertBearingY),
        vertAdvance: g(GM.vertAdvance),
      },
      // MONO: 1bpp/MSB 先；GRAY/SDF: 8bpp；LCD(_V): 3 子像素；BGRA: 4 字节预乘颜色。
      buffer,
    };
  }

  /** 两个 glyph index 间的 kerning（26.6），需字体含 kern 表 */
  kerning(leftIndex, rightIndex, mode = FT.KERNING_DEFAULT) {
    this._assertAlive();
    const m = this.module;
    const v = m._malloc(8);
    const e = this.ft._fn.GetKerning(this.ptr, leftIndex >>> 0, rightIndex >>> 0, mode, v);
    const O = this._O.FT_Vector;
    const r = e ? { x: 0, y: 0 } : { x: m.getValue(v + O.x, I32), y: m.getValue(v + O.y, I32) };
    m._free(v);
    return r;
  }

  destroy() {
    if (!this.ptr) return;
    this.ft._fn.DoneFace(this.ptr);
    this.ptr = 0;
    if (this._dataPtr) this.module._free(this._dataPtr);
    this._dataPtr = 0;
    this.ft._faces.delete(this);
  }
}
