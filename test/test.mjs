// CI 验证：核心是"大 CJK 字体不再 OOM"（相对 npm 上停滞的 freetype-wasm 的关键修复），
// 外加 MONO + 灰度 AA 两条渲染路径、advance/metrics、kerning、version 都可用。
// 跑前需先 build.sh 产出 ../dist/。需要联网拉一个大 CJK 字体。
import fs from "node:fs";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import initFreeType, { FT } from "../dist/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT = path.join(HERE, "wqy-microhei.ttc"); // ~5MB CJK，OOM 回归用例
const FONT_URL =
  "https://cdn.jsdelivr.net/gh/anthonyfok/fonts-wqy-microhei@cd82defe33ec0e86e628329f1b63049ef562c8e5/wqy-microhei.ttc";
const COLOR_FONT = path.join(HERE, "twemoji_smiley-sbix.ttf");
const COLOR_FONT_URL =
  "https://raw.githubusercontent.com/googlefonts/color-fonts/0046ea4c3b69e9fbbe464c2594816894e3aa5e4b/fonts/twemoji_smiley-sbix.ttf";
const BZIP_FONT = path.join(HERE, "bzip-fixture.pcf.bz2");

let pass = 0,
  fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.log("  ✗ " + m)));

function runWorkerSmoke(expectedVersion) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./worker-smoke.mjs", import.meta.url), { type: "module" });
    let settled = false;
    const finish = async (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (message.error) ok(false, `Web Worker 分支初始化失败: ${message.error}`);
      else ok(message.version.join(".") === expectedVersion, `Web Worker 分支初始化 FreeType ${message.version.join(".")}`);
      await worker.terminate();
      resolve();
    };
    const timer = setTimeout(() => finish({ error: "15 秒内未返回结果" }), 15_000);
    worker.once("message", finish);
    worker.once("error", (error) => finish({ error: error.stack || error.message }));
  });
}

async function main() {
  if (!fs.existsSync(FONT)) {
    console.log(">>> 拉 CJK 字体 …");
    const r = await fetch(FONT_URL);
    if (!r.ok) throw new Error("字体下载失败 " + r.status);
    fs.writeFileSync(FONT, Buffer.from(await r.arrayBuffer()));
  }
  const sizeMB = (fs.statSync(FONT).size / 1048576).toFixed(2);
  console.log(`>>> 字体 ${sizeMB}MB`);

  const wasmBinary = new Uint8Array(fs.readFileSync(path.join(HERE, "..", "dist", "freetype.wasm")));
  const ft = await initFreeType({ wasmBinary });
  const ver = ft.version();
  console.log(`>>> FreeType ${ver.join(".")}`);
  ok(ver[0] === 2 && ver[1] >= 10, `version() = ${ver.join(".")}`);
  ok(ft.errorString(1).length > 0 && !ft.errorString(1).startsWith("Unknown error"),
     `errorString(1) = ${ft.errorString(1)}`);
  await runWorkerSmoke(ver.join("."));
  // CI gate: the built library must match the package/tag upstream version.
  if (process.env.FT_VER) {
    ok(ver.join(".") === process.env.FT_VER, `built FreeType ${ver.join(".")} === FT_VER ${process.env.FT_VER}`);
  }

  // 关键：5MB CJK 字体加载不 OOM（旧 freetype-wasm 在这直接炸）
  let face;
  try {
    face = ft.newFace(fs.readFileSync(FONT));
    ok(true, `newFace 4MB+ CJK 不 OOM（核心修复）`);
  } catch (e) {
    ok(false, `newFace OOM/失败: ${e.message}`);
    finish();
    return;
  }
  const info = face.info();
  console.log("  face:", info.familyName, "| glyphs", info.numGlyphs, "| upem", info.unitsPerEM);
  ok(info.numGlyphs > 1000, `numGlyphs=${info.numGlyphs}（CJK 字体应上万）`);

  face.setPixelSizes(20, 10);
  const explicitSize = face.sizeMetrics();
  ok(explicitSize.xPpem === 20 && explicitSize.yPpem === 10,
     `setPixelSizes(width,height) = ${explicitSize.xPpem}x${explicitSize.yPpem}`);
  face.setPixelSize(48);
  const sm = face.sizeMetrics();
  ok(sm.xPpem === 48 && sm.yPpem === 48, `sizeMetrics ppem=${sm.xPpem}x${sm.yPpem}`);
  ok(sm.ascender > 0 && sm.descender < 0 && sm.height > 0,
     `sizeMetrics ascender=${sm.ascender} descender=${sm.descender} height=${sm.height}`);
  const cp = "字".codePointAt(0);
  const gi = face.charIndex(cp);
  ok(gi > 0, `charIndex('字')=${gi}`);

  let seenA = false, seenCjk = false, ordered = true, previousCodepoint = -1, iterated = 0;
  for (const item of face.characters()) {
    ordered &&= item.codepoint > previousCodepoint && item.glyphIndex > 0;
    previousCodepoint = item.codepoint;
    seenA ||= item.codepoint === 0x41;
    seenCjk ||= item.codepoint === cp;
    iterated++;
    if (seenA && seenCjk) break;
  }
  ok(ordered, "characters() 按码点升序且 glyph index 有效");
  ok(iterated > 0 && seenA && seenCjk, "characters() 覆盖 Latin 与 CJK 码点");

  // MONO（1-bit，hinted）—— 调用方自己选 MONO
  const mono = face.loadGlyph({ char: cp, flags: FT.LOAD_TARGET_MONO, renderMode: FT.RENDER_MODE_MONO });
  ok(mono.pixelMode === FT.PIXEL_MODE_MONO, `MONO pixelMode=${mono.pixelMode}（期望 1）`);
  ok(mono.width > 0 && mono.rows > 0 && mono.buffer.length > 0, `MONO 位图 ${mono.width}x${mono.rows}`);
  const monoBimodal = mono.buffer.every((b) => b === 0 || b === 255) || true; // MONO 是位打包，逐位非逐字节，跳过严格判
  ok(mono.advance.x >> 6 > 0, `MONO advance=${mono.advance.x >> 6}px`);

  // 灰度 AA —— 同字体同字，证明通用渲染路径也在（不只 MONO）
  const aa = face.loadGlyph({ char: cp, flags: FT.LOAD_DEFAULT, renderMode: FT.RENDER_MODE_NORMAL });
  ok(aa.pixelMode === FT.PIXEL_MODE_GRAY, `AA pixelMode=${aa.pixelMode}（期望 2=GRAY）`);
  const hasGray = aa.buffer.some((b) => b !== 0 && b !== 255);
  ok(hasGray, `AA 位图含灰阶（${aa.width}x${aa.rows}，证明非 1-bit 路径可用）`);
  ok(aa.metrics.horiAdvance > 0, `metrics.horiAdvance=${aa.metrics.horiAdvance}（26.6）`);

  // LCD / vertical LCD / signed-distance-field render modes.
  try {
    const lcd = face.loadGlyph({ char: cp, flags: FT.LOAD_TARGET_LCD, renderMode: FT.RENDER_MODE_LCD });
    const lcdV = face.loadGlyph({ char: cp, flags: FT.LOAD_TARGET_LCD_V, renderMode: FT.RENDER_MODE_LCD_V });
    const sdf = face.loadGlyph({ char: cp, flags: FT.LOAD_TARGET_SDF, renderMode: FT.RENDER_MODE_SDF });
    ok(lcd.pixelMode === FT.PIXEL_MODE_LCD && lcd.buffer.length > 0, `LCD pixelMode=${lcd.pixelMode}`);
    ok(lcdV.pixelMode === FT.PIXEL_MODE_LCD_V && lcdV.buffer.length > 0, `LCD_V pixelMode=${lcdV.pixelMode}`);
    ok(sdf.pixelMode === FT.PIXEL_MODE_GRAY && sdf.buffer.length > 0, `SDF pixelMode=${sdf.pixelMode}`);
  } catch (e) {
    ok(false, `LCD/SDF 渲染失败: ${e.message}`);
  }

  // kerning（调用通；该字体可能无 kern 表，值 0 也算通过——不抛即可）
  try {
    const k = face.kerning(gi, face.charIndex("体".codePointAt(0)));
    ok(true, `kerning 调用通 x=${k.x}`);
  } catch (e) {
    ok(false, `kerning 抛错: ${e.message}`);
  }

  // charmap 选择（通用 API 面）
  try {
    face.selectCharmap(FT.ENCODING_UNICODE);
    ok(true, `selectCharmap(UNICODE) 通`);
  } catch (e) {
    ok(false, `selectCharmap 抛错: ${e.message}`);
  }

  // Latin 宽度合理性：'m' 应明显宽于 'i'（advance 取整 26.6）
  const advOf = (ch) => face.loadGlyph({ char: ch.codePointAt(0) }).advance.x >> 6;
  const am = advOf("m"), ai = advOf("i");
  ok(am > ai && ai > 0, `Latin advance 合理：m=${am} > i=${ai} > 0`);

  face.destroy();
  face.destroy(); // destroy 应可重复调用

  // WOFF2 —— 验证 brotli 真编进去了（旧窄构建直接不支持）
  try {
    const woff2Path = path.join(HERE, "inter.woff2");
    if (!fs.existsSync(woff2Path)) {
      const r = await fetch(
        "https://cdn.jsdelivr.net/npm/@fontsource/inter@5.0.0/files/inter-latin-400-normal.woff2"
      );
      if (!r.ok) throw new Error("woff2 下载失败 " + r.status);
      fs.writeFileSync(woff2Path, Buffer.from(await r.arrayBuffer()));
    }
    const wface = ft.newFace(fs.readFileSync(woff2Path));
    wface.setPixelSize(32);
    const wg = wface.loadGlyph({ char: "A".codePointAt(0) });
    ok(wg.width > 0 && wg.rows > 0 && wg.advance.x >> 6 > 0,
       `WOFF2 解码并渲染 'A' ${wg.width}x${wg.rows}（证明 brotli 已编入）`);
    wface.destroy();
  } catch (e) {
    ok(false, `WOFF2 用例失败: ${e.message}`);
  }

  // bzip2-compressed BDF exercises FreeType's memory-stream decompressor.
  try {
    const bface = ft.newFace(fs.readFileSync(BZIP_FONT));
    bface.setPixelSize(8);
    const bg = bface.loadGlyph({ index: 1 });
    ok(bg.width > 0 && bg.rows > 0, `bzip2 PCF 解码并渲染 glyph ${bg.width}x${bg.rows}`);
    bface.destroy();
  } catch (e) {
    ok(false, `bzip2 字体用例失败: ${e.message}`);
  }

  // Embedded PNG color bitmap (sbix) support.
  try {
    if (!fs.existsSync(COLOR_FONT)) {
      const r = await fetch(COLOR_FONT_URL);
      if (!r.ok) throw new Error("彩色字体下载失败 " + r.status);
      fs.writeFileSync(COLOR_FONT, Buffer.from(await r.arrayBuffer()));
    }
    const cface = ft.newFace(fs.readFileSync(COLOR_FONT));
    const cinfo = cface.info();
    ok(cinfo.numFixedSizes > 0, `PNG 彩色字体固定尺寸数=${cinfo.numFixedSizes}`);
    cface.selectSize(0);
    const cg = cface.loadGlyph({ char: 0x1f603, flags: FT.LOAD_COLOR });
    ok(cg.pixelMode === FT.PIXEL_MODE_BGRA && cg.buffer.length > 0,
       `PNG 彩色字形 pixelMode=${cg.pixelMode} ${cg.width}x${cg.rows}`);
    cface.destroy();
  } catch (e) {
    ok(false, `PNG 彩色字形用例失败: ${e.message}`);
  }

  // 原生逃生口可达
  ok(typeof ft.module.cwrap === "function" && typeof ft.module.HEAPU8 === "object",
     `原生层可达（ft.module.cwrap/HEAPU8）`);
  ok(ft.offsets && ft.offsets.FT_FaceRec && ft.offsets.pointerBytes === 4,
     `struct 偏移注入且为 wasm32（pointerBytes=${ft.offsets && ft.offsets.pointerBytes}）`);

  const iteratorFace = ft.newFace(fs.readFileSync(FONT));
  const iterator = iteratorFace.characters();
  ok(!iterator.next().done, "characters() 可暂停迭代");
  iteratorFace.destroy();
  try {
    iterator.next();
    ok(false, "Face 销毁后暂停的 characters() 应拒绝继续迭代");
  } catch (e) {
    ok(e.message.includes("已销毁"), `销毁后迭代返回明确错误: ${e.message}`);
  }

  const autoDestroyedFace = ft.newFace(fs.readFileSync(FONT));
  ft.destroy();
  ok(autoDestroyedFace.ptr === 0 && ft.library === 0, "destroy() 自动释放仍存活的 Face");
  autoDestroyedFace.destroy();
  ft.destroy();
  try {
    autoDestroyedFace.info();
    ok(false, "已销毁 Face 应拒绝继续访问");
  } catch (e) {
    ok(e.message.includes("已销毁"), `已销毁 Face 返回明确错误: ${e.message}`);
  }
  try {
    ft.version();
    ok(false, "已销毁 FreeType 应拒绝继续访问");
  } catch (e) {
    ok(e.message.includes("已销毁"), `已销毁 FreeType 返回明确错误: ${e.message}`);
  }
  finish();
}

function finish() {
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("TEST FAIL:", e);
  process.exit(1);
});
