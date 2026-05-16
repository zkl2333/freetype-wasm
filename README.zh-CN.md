# freetype-wasm（中文）

[English → README.md](./README.md)

正确构建的通用 [FreeType](https://freetype.org/) WebAssembly 版：内存可增长（能加载数 MB 的 CJK 字体）、暴露**完整 FreeType 公共 C API**、Node 与浏览器通用、版本号对齐上游 FreeType。

> 不发 npm，也不发 GitHub Release —— 分发就是 git tag 本身。CI 在每个 tag 上构建并把 `dist/`（wasm+glue+wrapper）提交进该 tag，直接可消费。任选其一（`<tag>` 如 `v2.13.3-3`，跟随 FreeType 版本）：
> - **jsdelivr**：`import initFreeType, { FT } from "https://cdn.jsdelivr.net/gh/zkl2333/freetype-wasm@<tag>/dist/index.mjs"`
> - **npm 装 GitHub**：`npm i github:zkl2333/freetype-wasm#<tag>` → `import ... from "freetype-wasm"`
> - **git**：`git clone --branch <tag>` 用 `dist/`，或 `git archive`
>
> 可用 tag 见 [tags 页](../../tags)。上游 FreeType 新版由定时任务自动构建+验证+打 tag。

## 为什么有这个

npm 上唯一的通用「FreeType → WASM」包 [`freetype-wasm`](https://www.npmjs.com/package/freetype-wasm) 自 2022 年起停止维护。它的预构建 `.wasm` **未开启 `ALLOW_MEMORY_GROWTH`**、堆固定约 16 MB 且无法从 JS 抬高，加载数 MB 的 CJK 字体会 `Aborted(OOM)`（CJK 字体 glyph/charmap 表大，FreeType 分配随之增长）。

这是打包问题，不是 FreeType 的缺陷。其它方案也不在这个生态位：HarfBuzz-WASM 只排版不光栅，CanvasKit 是 Skia（抗锯齿、无 hinted 1-bit），fontkit/opentype.js 无 hinting，`freetype2` 是原生 node-gyp 而非 WASM。

本仓库把构建做对：

- **`ALLOW_MEMORY_GROWTH=1`** —— 数 MB CJK 字体不再 OOM（核心修复）。
- 暴露**完整 FreeType 公共 C API**（从头文件抽取所有 `FT_EXPORT` 并与实际库符号取交集，而非手挑切片）+ Emscripten 运行时助手 + wasm32 结构体偏移，可调用任意 FreeType 函数。
- 薄 JS 包装（`FreeType` / `Face`）覆盖常见路径；MONO 还是抗锯齿由调用方通过 load flags 决定，本库不替你选。
- Node 与浏览器（`ENVIRONMENT=node,web`）。
- 构建可复现；发布 tag 对齐上游 FreeType 版本。

来由：<https://blog.zkl2333.com/posts/eink-render-pure-node/>

## 用法

下载一个 [release](../../releases) 解包，是自包含的 `dist/`：

```js
import initFreeType, { FT } from "./dist/index.mjs";

const ft = await initFreeType(); // 浏览器自动 fetch 同目录 .wasm
// Node：const ft = await initFreeType({ wasmBinary: fs.readFileSync("dist/freetype.wasm") });

const face = ft.newFace(fontBytes); // Uint8Array — TTF/OTF/TTC/WOFF/WOFF2/Type1/CFF
face.setPixelSize(48);

const aa = face.loadGlyph({ char: "字".codePointAt(0) }); // 灰度 AA，pixelMode 2
const mono = face.loadGlyph({                              // 1-bit MONO，pixelMode 1
  char: "字".codePointAt(0),
  flags: FT.LOAD_TARGET_MONO,
  renderMode: FT.RENDER_MODE_MONO,
});

face.destroy();
ft.destroy();
```

## API

两层：

1. **便捷层** `FreeType` / `Face`（见 [`src/index.d.ts`](./src/index.d.ts)）：`newFace`、`setPixelSize`/`setCharSize`、`loadGlyph`、`charIndex`、`selectCharmap`、`kerning`、`info`、`version`。
2. **原生层** `ft.module` 是完整 Emscripten 模块（`ccall`/`cwrap`/`getValue`/`setValue`/`HEAPU8`/`_malloc`/`_free`/`addFunction`），配 `ft.offsets`（wasm32 结构体字段偏移）可达便捷层未包的任意 FreeType 函数。

## 支持的格式 / 限制

**支持**：TrueType（TTF/TTC）、OpenType/CFF（OTF）、WOFF、**WOFF2**（已编入 Brotli）、Type1、CFF，以及 FreeType 完整 glyph/outline/bitmap/MONO/AA/kerning/charmap API。

**未启用**（冷门、需额外外部依赖，有需要提 issue）：bzip2 压缩 PCF、彩色位图字体内嵌 PNG（`sbix`/`CBDT`）、FreeType 内部 HarfBuzz autohint。结构体偏移只内置渲染常用项（`struct-offsets.json` / `offsets.mjs`），其余可同法自行扩展。

## 版本号

tag 对齐上游 FreeType，且 `package.json` `version` 由 CI 按 tag 盖同：

- `vX.Y.Z` → FreeType X.Y.Z（version `X.Y.Z`）
- `vX.Y.Z-N` → 仍 FreeType X.Y.Z，仅打包/wrapper 第 N 次修订（version `X.Y.Z-N`）

定时任务监视上游 FreeType，出新版即自动构建+验证，**仅验证通过**才打对应 `vX.Y.Z` tag。在 jsdelivr URL / git 安装 ref 里钉某个 tag 即锁定 FreeType 版本。

## 可复现构建

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
