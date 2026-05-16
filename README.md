# freetype-wasm

完整 [FreeType](https://freetype.org/) 编成的通用 WASM 模块——**正确构建**的那种：内存可增长（能吃 4MB+ 的 CJK 字体）、暴露 FreeType 完整公共 C API、Node 与浏览器通用、版本号对齐上游 FreeType。

> 不发 npm。用 [GitHub Releases](../../releases) 取预构建产物，或本地 `docker build` 自己出。

## 为什么有这个

npm 上能找到的通用「FreeType→WASM」只有一个 [`freetype-wasm`](https://www.npmjs.com/package/freetype-wasm)，2022 年后停滞、单作者、面向浏览器。它有个硬伤：**预构建的 .wasm 没开 `ALLOW_MEMORY_GROWTH`、堆固定 ~16MB，且从 JS 传 `INITIAL_MEMORY` 也覆盖不进** → 加载几 MB 的 CJK 字体直接 `Aborted(OOM)`（CJK 字体 glyph/charmap 表大，FreeType 分配跟着涨）。

不是 FreeType 的 bug，是**打包姿势不对**。其它候选都不在这个生态位：HarfBuzz-WASM 只做排版不光栅，CanvasKit 是 Skia 抗锯齿（拿不到 hinted 1-bit），fontkit/opentype.js 没 hinting，`freetype2` 是原生 node-gyp 不是 wasm。

这个仓库就是把那一步做对：

- `-sALLOW_MEMORY_GROWTH=1` —— 4MB+ CJK 字体不再 OOM（核心修复）
- 暴露 **FreeType 完整公共 C API**（不是某个窄切片）+ Emscripten 运行时助手 → 调用方能干 FreeType 能干的一切，MONO 还是灰度 AA 自己传 flag
- Node + 浏览器都能用（`ENVIRONMENT=node,web`）
- 构建可复现，tag 对齐上游 FreeType 版本

来由见这篇博客：<https://blog.zkl2333.com/posts/eink-render-pure-node/>

## 用法

下载一个 Release，解包后是个自包含 `dist/`：

```js
import initFreeType, { FT } from "./dist/index.mjs";

const ft = await initFreeType();                 // 浏览器：自动 fetch 同目录 .wasm
// Node：const ft = await initFreeType({ wasmBinary: fs.readFileSync("dist/freetype.wasm") });

const face = ft.newFace(fontBytes /* Uint8Array, TTF/OTF/TTC/Type1/CFF */);
face.setPixelSize(48);

// 灰度 AA（默认）
const aa = face.loadGlyph({ char: "字".codePointAt(0) });
// → { width, rows, pitch, pixelMode:2, buffer:Uint8Array(8bpp), advance, metrics, ... }

// 1-bit MONO（hinted，适合墨水屏/像素屏）
const mono = face.loadGlyph({
  char: "字".codePointAt(0),
  flags: FT.LOAD_TARGET_MONO,
  renderMode: FT.RENDER_MODE_MONO,
}); // pixelMode:1，buffer 按 |pitch| 行、MSB 先

face.destroy(); ft.destroy();
```

便捷层（`Face`）只覆盖最常见路径。**任何高级用法走原生层**——`ft.module` 是完整 Emscripten 模块，配 `ft.offsets`（wasm32 结构体字段偏移）直达任意 FreeType 函数：

```js
const m = ft.module;
const f = m.cwrap("FT_Some_Function", "number", ["number", "number"]);
// 读结构体字段：m.getValue(facePtr + ft.offsets.FT_FaceRec.num_glyphs, "i32")
```

## 通用性边界

- **完整公共 API**：产物导出所有 `FT_EXPORT` 的 FreeType 函数（从头文件自动抽取，不是手绑），都可经 `ccall/cwrap` 调用。
- **不支持**：WOFF2 / 字体内嵌 PNG / zlib 压缩字体——为自包含、产物小，构建时关掉了 zlib/png/harfbuzz/brotli/bzip2 这些可选外部依赖。**TTF / OTF / TTC / Type1 / CFF 全支持。** 需要 WOFF2 请提 issue（要把 brotli 也编进来）。
- 结构体偏移只内置了渲染常用的若干（`struct-offsets.json` / `offsets.mjs`），其余调用方可按同法自行扩展。

## 版本号

tag 对齐上游 FreeType：

- `vX.Y.Z` → 构建 FreeType X.Y.Z
- `vX.Y.Z-N` → 仍 FreeType X.Y.Z，仅本仓库打包/wrapper 变更（`-N` 为打包修订）

## 本地构建（可复现）

零本机工具链，靠 Docker：

```bash
docker build -t freetype-wasm .
docker run --rm -v "$PWD/dist:/src/dist" freetype-wasm
node test/test.mjs
```

构建环境钉死 `emscripten/emsdk:3.1.74`，FreeType 源取自 GNU Savannah（`FT_VER` 环境变量可覆盖）。GitHub CI 用同一镜像，产物字节可复现。

## 许可

- 本仓库的构建脚本与 JS 包装：**MIT**（见 [LICENSE](LICENSE)）。
- 发布的 `.wasm` 内嵌 FreeType，受 **FreeType License (FTL)** 或 GPLv2 双重许可约束。按 FTL，使用本产物需在文档里署名致谢 FreeType：

  > Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved.
