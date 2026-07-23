# freetype-wasm（中文）

通用 [FreeType](https://freetype.org/) WebAssembly 版：内存可增长（能加载数 MB 的 CJK 字体）、暴露**完整 FreeType 公共 C API**，可用于 Node、浏览器与 Module Worker。

[English → README.md](./README.md)

已发布为 npm 包 [`@zkl2333/freetype-wasm`](https://www.npmjs.com/package/@zkl2333/freetype-wasm)。也可通过 git tag 或 jsdelivr 使用固定版本。

## 为什么有这个

npm 上唯一的通用「FreeType → WASM」包 [`freetype-wasm`](https://www.npmjs.com/package/freetype-wasm) 自 2022 年起停止维护。它的预构建 `.wasm` **未开启 `ALLOW_MEMORY_GROWTH`**、堆固定约 16 MB 且无法从 JS 抬高，加载数 MB 的 CJK 字体会 `Aborted(OOM)`（CJK 字体 glyph/charmap 表大，FreeType 分配随之增长）。

OOM 是构建配置问题，不是 FreeType 的缺陷。也没有别的库满足同一需求：在 Node 和浏览器里、以 WASM 做 FreeType 级别的 hinted 光栅化（1-bit MONO 与灰度 AA 都要）。HarfBuzz-WASM 只排版、不做光栅；CanvasKit 是 Skia，只有抗锯齿、没有 hinted 1-bit；fontkit / opentype.js 不做 hinting；npm 上的 `freetype2` 是原生 node-gyp 插件、不是 WASM。

本构建提供：

- **`ALLOW_MEMORY_GROWTH=1`**：数 MB CJK 字体不再 OOM。
- 暴露**完整 FreeType 公共 C API**：从头文件抽取所有 `FT_EXPORT` 并与实际库符号取交集（而非手挑子集），外加 Emscripten 运行时助手与 wasm32 结构体偏移，可调用任意 FreeType 函数。
- 薄 JS 包装（`FreeType` / `Face`）覆盖常见路径；MONO 或抗锯齿由调用方通过 load flags 指定。
- Node、浏览器与 Module Web Worker（`ENVIRONMENT=node,web,worker`）。
- 钉死 Emscripten 镜像，并对原生依赖做签名/哈希验证；发布 tag 仅在 CI 完整验证后创建且不可变。

## 安装

从 npm 安装：

```bash
npm install @zkl2333/freetype-wasm
```

```js
import initFreeType, { FT } from "@zkl2333/freetype-wasm";
```

CI 会把 `dist/`（wasm + glue + wrapper）提交到每个不可变的包发布 tag。`<tag>` 是 `v` + npm 包版本，例如 `v3.0.0`。其他分发方式：

- **npm 装 GitHub**：`npm i github:zkl2333/freetype-wasm#<tag>`
- **git**：`git clone --branch <tag>` 用 `dist/`，或 `git archive`
- **jsdelivr**（可选；浏览器/Deno，ESM，免打包）：
  `import initFreeType, { FT } from "https://cdn.jsdelivr.net/gh/zkl2333/freetype-wasm@<tag>/dist/index.mjs"`

可用 tag 见 [tags 页](../../tags)，每个 tag 都包含与 npm 发布完全一致的文件。

## 快速开始

```js
import initFreeType, { FT } from "@zkl2333/freetype-wasm"; // 或上方的 jsdelivr URL

// 浏览器：.wasm 自动从同目录 fetch
const ft = await initFreeType();
// Node：const ft = await initFreeType({ wasmBinary: fs.readFileSync("dist/freetype.wasm") });

const face = ft.newFace(fontBytes); // Uint8Array — TTF/OTF/TTC/WOFF/WOFF2/Type1/CFF
face.setPixelSize(48); // 高度 48px；可选第二参数为宽度

// 灰度抗锯齿（默认）
const aa = face.loadGlyph({ char: "字".codePointAt(0) });
// → { width, rows, pitch, pixelMode: 2, buffer: Uint8Array (8bpp), advance, metrics, ... }

// hinted 1-bit MONO（电子墨水 / 像素屏）
const mono = face.loadGlyph({
  char: "字".codePointAt(0),
  flags: FT.LOAD_TARGET_MONO,
  renderMode: FT.RENDER_MODE_MONO,
}); // pixelMode: 1，buffer 按 |pitch| 行打包 1bpp，MSB 先

// bitmap-only 的 sbix/CBDT 字体需选择固定 strike，返回 BGRA 像素
const colorFace = ft.newFace(colorFontBytes);
colorFace.selectSize(0);
const color = colorFace.loadGlyph({ char: 0x1f603, flags: FT.LOAD_COLOR });
colorFace.destroy();

const metrics = face.sizeMetrics();
for (const { codepoint, glyphIndex } of face.characters()) {
  // 可用于生成字体覆盖表或 atlas；拿够数据后随时 break
}

face.destroy();
ft.destroy();
```

同一套 import 可直接用于 Module Worker（`new Worker(url, { type: "module" })`）。每个 Worker 持有独立的 FreeType 实例和 WASM 内存；若 `.wasm` 放在其他地址，可向 `initFreeType` 传 `locateFile` 或 `wasmBinary`。

## API

两层：

1. **便捷层** —— `FreeType` / `Face`（见 [`src/index.d.ts`](./src/index.d.ts)）：`newFace`、`setPixelSize`/`setPixelSizes`/`setCharSize`/`selectSize`、`loadGlyph`、`charIndex`、`characters`、`selectCharmap`、`kerning`、`info`、`sizeMetrics`、`version`、`errorString`。
2. **原生层** —— `ft.module` 是完整 Emscripten 模块（`ccall`/`cwrap`/`getValue`/`setValue`/`HEAPU8`/`_malloc`/`_free`/`addFunction`）。配 `ft.offsets`（wasm32 结构体字段偏移）可达便捷层未包的**任意** FreeType 函数：

```js
const m = ft.module;
const fn = m.cwrap("FT_Some_Function", "number", ["number", "number"]);
const numGlyphs = m.getValue(facePtr + ft.offsets.FT_FaceRec.num_glyphs, "i32");
```

便捷层创建的句柄不要从原生层修改引用计数（`FT_Reference_Face` / `FT_Reference_Library`）或调用原生 `FT_Done_*`，请使用 `face.destroy()` / `ft.destroy()`；使用这些句柄的 raw 调用必须先于 wrapper 销毁结束。需要自定义原生生命周期时，请完全通过 raw API 创建和管理对应 face。

## 支持的格式 / 限制

**支持**：TrueType（TTF/TTC）、OpenType/CFF（OTF）、WOFF、**WOFF2**（Brotli）、bzip2 压缩字体、内嵌 PNG 彩色位图（`sbix`/`CBDT`）、Type1、CFF，以及 FreeType 的 glyph/outline/bitmap/MONO/AA/LCD/SDF/kerning/charmap API。

**限制**：未启用 FreeType 内部 HarfBuzz autohint 辅助（文本 shaping 本就不属于 FreeType）；OT-SVG 需要应用自行提供 SVG renderer；Emscripten 文件系统已关闭，请使用 `newFace(bytes)` 而非路径 API。结构体偏移只内置渲染常用项（`struct-offsets.json` / `offsets.mjs`），其余可同法自行扩展。

## 版本号

npm 包 SemVer 与内置 FreeType 版本独立管理：`package.json.version` 是 npm/Git 发布版本，`package.json.freetypeVersion` 记录上游库版本。例如包 `3.0.0` 内置 FreeType `2.14.3`。

npm 版本和 `vX.Y.Z` Git tag 都不可变，并统一使用包版本。同一 FreeType 下兼容的 wrapper/构建修复递增包 patch；升级 FreeType 或兼容新增 API 通常递增 minor；JS 或 TypeScript API 有破坏性变化时递增 major。

每次发布都在 GitHub Actions 的 **publish-npm** workflow 中手动输入两个版本。CI 会验签/验哈希、隔离构建、跑测试、创建不可变 tag，再通过 npm Trusted Publisher OIDC 携 provenance 发布；本地不执行 `npm publish`，也不手动打 tag。

旧 npm/Git 版本 `2.14.3` 会冻结在最初发布内容；使用 `^2.14.3` 的项目不会自动跨到包 `3.0.0`。

- **要当前 npm 版本**：`npm install @zkl2333/freetype-wasm`。
- **要不可变的 Git/jsdelivr 版本**：钉 `v3.0.0` 或对应 commit SHA。

## 可重复构建流程

本机无需工具链：

```bash
docker build -t freetype-wasm .
docker run --rm -v "$PWD/dist:/src/dist" freetype-wasm
node test/test.mjs
```

amd64 的 Emscripten 3.1.74 镜像按 digest 钉死。FreeType 发布归档在解压前用仓库内置的官方发布公钥验签；zlib、libpng、bzip2、Brotli 归档按 SHA-256 校验；CI 使用同一基础镜像。实时 apt 包与 CMake 尚未完全钉死，因此这里承诺的是经过验证的可重复构建流程，不宣称不同时间构建必然逐字节一致。

## 许可

- 本仓库构建脚本与 JS 包装：**MIT**（见 [LICENSE](./LICENSE)）。
- 发布的 `.wasm` 内嵌 FreeType、Brotli、bzip2、libpng、zlib、musl、compiler-rt 及 Emscripten 运行时代码，每个发布包的 `dist/licenses/` 都带有对应许可/声明。FreeType 采用 FreeType License（FTL）分发；按 FTL，使用产物需署名致谢 FreeType：

  > Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved.
