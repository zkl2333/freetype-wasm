// CI 验证：核心是"大 CJK 字体不再 OOM"（相对 npm 上停滞的 freetype-wasm 的关键修复），
// 外加 MONO + 灰度 AA 两条渲染路径、advance/metrics、kerning、version 都可用。
// 跑前需先 build.sh 产出 ../dist/。需要联网拉一个大 CJK 字体。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import initFreeType, { FT } from "../dist/index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONT = path.join(HERE, "wqy-microhei.ttc"); // ~5MB CJK，OOM 回归用例
const FONT_URL =
  "https://cdn.jsdelivr.net/gh/anthonyfok/fonts-wqy-microhei@master/wqy-microhei.ttc";

let pass = 0,
  fail = 0;
const ok = (c, m) => (c ? (pass++, console.log("  ✓ " + m)) : (fail++, console.log("  ✗ " + m)));

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

  face.setPixelSize(48);
  const cp = "字".codePointAt(0);
  const gi = face.charIndex(cp);
  ok(gi > 0, `charIndex('字')=${gi}`);

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

  // 原生逃生口可达
  ok(typeof ft.module.cwrap === "function" && typeof ft.module.HEAPU8 === "object",
     `原生层可达（ft.module.cwrap/HEAPU8）`);
  ok(ft.offsets && ft.offsets.FT_FaceRec && ft.offsets.pointerBytes === 4,
     `struct 偏移注入且为 wasm32（pointerBytes=${ft.offsets && ft.offsets.pointerBytes}）`);

  ft.destroy();
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
