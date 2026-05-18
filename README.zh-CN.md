# freetype-wasm（中文）

通用 [FreeType](https://freetype.org/) WebAssembly 版：内存可增长（能加载数 MB 的 CJK 字体）、暴露**完整 FreeType 公共 C API**、Node 与浏览器通用、版本号对齐上游 FreeType。

[English → README.md](./README.md)

> npm 包计划中、暂未发布。当前从 git tag 安装：`npm i github:`（或 jsdelivr），或自己用 Docker 构建。

## 为什么有这个

npm 上唯一的通用「FreeType → WASM」包 [`freetype-wasm`](https://www.npmjs.com/package/freetype-wasm) 自 2022 年起停止维护。它的预构建 `.wasm` **未开启 `ALLOW_MEMORY_GROWTH`**、堆固定约 16 MB 且无法从 JS 抬高，加载数 MB 的 CJK 字体会 `Aborted(OOM)`（CJK 字体 glyph/charmap 表大，FreeType 分配随之增长）。

OOM 是构建配置问题，不是 FreeType 的缺陷。也没有别的库满足同一需求：在 Node 和浏览器里、以 WASM 做 FreeType 级别的 hinted 光栅化（1-bit MONO 与灰度 AA 都要）。HarfBuzz-WASM 只排版、不做光栅；CanvasKit 是 Skia，只有抗锯齿、没有 hinted 1-bit；fontkit / opentype.js 不做 hinting；npm 上的 `freetype2` 是原生 node-gyp 插件、不是 WASM。

本构建提供：

- **`ALLOW_MEMORY_GROWTH=1`**：数 MB CJK 字体不再 OOM。
- 暴露**完整 FreeType 公共 C API**：从头文件抽取所有 `FT_EXPORT` 并与实际库符号取交集（而非手挑子集），外加 Emscripten 运行时助手与 wasm32 结构体偏移，可调用任意 FreeType 函数。
- 薄 JS 包装（`FreeType` / `Face`）覆盖常见路径；MONO 或抗锯齿由调用方通过 load flags 指定。
- Node 与浏览器（`ENVIRONMENT=node,web`）。
- 构建可复现；发布 tag 对齐上游 FreeType 版本。

## 安装

分发就是 git tag（npm 包计划中、暂未发布；不用 GitHub Release）：CI 在每个 tag 构建并把 `dist/`（wasm+glue+wrapper）提交进去，直接可消费。tag 与上游 FreeType 1:1，`<tag>` 就是 `v` + FreeType 版本，如 `v2.14.3`：

- **npm 装 GitHub**（Node 打包器）：
  `npm i github:zkl2333/freetype-wasm#<tag>` → `import initFreeType, { FT } from "freetype-wasm"`
- **git**：`git clone --branch <tag>` 用 `dist/`，或 `git archive`
- **jsdelivr**（可选；浏览器/Deno，ESM，免打包）：
  `import initFreeType, { FT } from "https://cdn.jsdelivr.net/gh/zkl2333/freetype-wasm@<tag>/dist/index.mjs"`

可用 tag 见 [tags 页](../../tags)。上游 FreeType 新版由定时任务自动构建+验证+打 tag。

## 快速开始

```js
import initFreeType, { FT } from "./dist/index.mjs"; // 或上方的包名 / jsdelivr URL

// 浏览器：.wasm 自动从同目录 fetch
const ft = await initFreeType();
// Node：const ft = await initFreeType({ wasmBinary: fs.readFileSync("dist/freetype.wasm") });

const face = ft.newFace(fontBytes); // Uint8Array — TTF/OTF/TTC/WOFF/WOFF2/Type1/CFF
face.setPixelSize(48);

// 灰度抗锯齿（默认）
const aa = face.loadGlyph({ char: "字".codePointAt(0) });
// → { width, rows, pitch, pixelMode: 2, buffer: Uint8Array (8bpp), advance, metrics, ... }

// hinted 1-bit MONO（电子墨水 / 像素屏）
const mono = face.loadGlyph({
  char: "字".codePointAt(0),
  flags: FT.LOAD_TARGET_MONO,
  renderMode: FT.RENDER_MODE_MONO,
}); // pixelMode: 1，buffer 按 |pitch| 行打包 1bpp，MSB 先

face.destroy();
ft.destroy();
```

## API

两层：

1. **便捷层** —— `FreeType` / `Face`（见 [`src/index.d.ts`](./src/index.d.ts)）：`newFace`、`setPixelSize`/`setCharSize`、`loadGlyph`、`charIndex`、`selectCharmap`、`kerning`、`info`、`version`。
2. **原生层** —— `ft.module` 是完整 Emscripten 模块（`ccall`/`cwrap`/`getValue`/`setValue`/`HEAPU8`/`_malloc`/`_free`/`addFunction`）。配 `ft.offsets`（wasm32 结构体字段偏移）可达便捷层未包的**任意** FreeType 函数：

```js
const m = ft.module;
const fn = m.cwrap("FT_Some_Function", "number", ["number", "number"]);
const numGlyphs = m.getValue(facePtr + ft.offsets.FT_FaceRec.num_glyphs, "i32");
```

## 支持的格式 / 限制

**支持**：TrueType（TTF/TTC）、OpenType/CFF（OTF）、WOFF、**WOFF2**（已编入 Brotli）、Type1、CFF，以及 FreeType 完整 glyph/outline/bitmap/MONO/AA/kerning/charmap API。

**未启用**（冷门、需额外外部依赖，有需要提 issue）：bzip2 压缩 PCF、彩色位图字体内嵌 PNG（`sbix`/`CBDT`）、FreeType 内部 HarfBuzz autohint。结构体偏移只内置渲染常用项（`struct-offsets.json` / `offsets.mjs`），其余可同法自行扩展。

## 版本号

tag 与上游 FreeType 严格 **1:1**（没有上游不存在的 tag）。`vX.Y.Z` 由 FreeType X.Y.Z 构建（`package.json` `version` 由 CI 盖成 `X.Y.Z`）。

`vX.Y.Z` 是**该 FreeType 版本“当前最优构建”的滚动指针**，不是冻结产物。定时任务监视上游、新版自动打 tag（构建+验证为门）。打包脚本/wrapper 改进但 FreeType 没升级时，原地强制重建同一个 `vX.Y.Z`（无 `-N`/合成版本号），并自动 purge jsdelivr 的 tag 缓存，消费方很快就能拿到新构建。

- **要某 FreeType 版本的最新好构建** → 钉 tag：`@v2.14.3`。
- **要字节级永不变的产物**（可复现） → 钉**构建提交 SHA**，而非 tag。jsdelivr 和 `npm i github:…#<sha>` 都吃 SHA，SHA 天然不可变。每次构建的 SHA 打在该次 `build-tag` CI 日志里。

重发同一 FreeType 版本的新构建：手动跑 **build-tag** workflow（Actions → build-tag → Run workflow → 填版本号），无需本地打 tag。

## 可复现构建

本机无需工具链：

```bash
docker build -t freetype-wasm .
docker run --rm -v "$PWD/dist:/src/dist" freetype-wasm
node test/test.mjs
```

钉死 `emscripten/emsdk:3.1.74`；FreeType 取自 GNU Savannah，Brotli 取自 google/brotli release（`FT_VER` / `BROTLI_VER` 可覆盖）。CI 用同一镜像，产物字节可复现。

## 许可

- 本仓库构建脚本与 JS 包装：**MIT**（见 [LICENSE](./LICENSE)）。
- 发布的 `.wasm` 内嵌 FreeType 与 Brotli。FreeType 受 FreeType License (FTL) / GPLv2 约束，Brotli 为 MIT。按 FTL，使用产物需署名致谢 FreeType：

  > Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved.
