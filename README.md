# freetype-wasm

A general-purpose WebAssembly build of [FreeType](https://freetype.org/): memory-growable (loads multi-MB CJK fonts), exposes the **complete FreeType public C API**, works in Node and the browser, versioned to upstream FreeType.

[中文说明 → README.zh-CN.md](./README.zh-CN.md)

Published on npm as [`@zkl2333/freetype-wasm`](https://www.npmjs.com/package/@zkl2333/freetype-wasm). Git tags and jsdelivr remain available for version-pinned or no-bundler use.

## Why this exists

The only general "FreeType → WASM" package on npm, [`freetype-wasm`](https://www.npmjs.com/package/freetype-wasm), has been unmaintained since 2022. Its prebuilt `.wasm` is compiled **without `ALLOW_MEMORY_GROWTH`** and with a fixed ~16 MB heap that cannot be raised from JS, so loading a multi-MB CJK font aborts with `Aborted(OOM)` (CJK fonts have large glyph/charmap tables; FreeType's allocations scale accordingly).

That OOM is a build-config problem, not a FreeType bug. No other library fills the same need either: FreeType-quality hinted rasterization (both 1-bit MONO and AA) as WASM, in Node and the browser. HarfBuzz-WASM only shapes text, it does not rasterize; CanvasKit is Skia, anti-aliased only with no hinted 1-bit; fontkit and opentype.js do not hint; the `freetype2` npm package is a native node-gyp addon, not WASM.

What this build provides:

- **`ALLOW_MEMORY_GROWTH=1`**: multi-MB CJK fonts no longer OOM.
- Exposes the **complete FreeType public C API**: every `FT_EXPORT` symbol present in the build, taken from the headers and intersected with the actual library (not a hand-picked subset), plus Emscripten runtime helpers and wasm32 struct offsets, so callers can reach any FreeType function.
- A thin JS wrapper (`FreeType` / `Face`) covers the common path; the caller selects MONO or anti-aliased output via load flags.
- Node and browser (`ENVIRONMENT=node,web`).
- Reproducible build; release tags track upstream FreeType versions.

## Install

From npm:

```bash
npm install @zkl2333/freetype-wasm
```

```js
import initFreeType, { FT } from "@zkl2333/freetype-wasm";
```

CI also builds every release tag and commits `dist/` (wasm + glue + wrapper) into it. Tags map 1:1 to upstream FreeType, so `<tag>` is `v` + the FreeType version, e.g. `v2.14.3`. Alternative distribution routes:

- **npm from GitHub**: `npm i github:zkl2333/freetype-wasm#<tag>`
- **git**: `git clone --branch <tag>` and use `dist/`, or `git archive`.
- **jsdelivr** (optional — browser/Deno, ESM, no bundler):
  `import initFreeType, { FT } from "https://cdn.jsdelivr.net/gh/zkl2333/freetype-wasm@<tag>/dist/index.mjs"`

Available tags: see the [tags page](../../tags). New upstream FreeType releases are picked up automatically (a scheduled job builds, verifies, and tags them).

## Quick start

```js
import initFreeType, { FT } from "@zkl2333/freetype-wasm"; // or the jsdelivr URL above

// Browser: the .wasm is fetched from the same directory automatically.
const ft = await initFreeType();
// Node: const ft = await initFreeType({ wasmBinary: fs.readFileSync("dist/freetype.wasm") });

const face = ft.newFace(fontBytes); // Uint8Array — TTF/OTF/TTC/WOFF/WOFF2/Type1/CFF
face.setPixelSize(48);

// Anti-aliased grayscale (default)
const aa = face.loadGlyph({ char: "字".codePointAt(0) });
// → { width, rows, pitch, pixelMode: 2, buffer: Uint8Array (8bpp), advance, metrics, ... }

// Hinted 1-bit MONO (for e-ink / pixel displays)
const mono = face.loadGlyph({
  char: "字".codePointAt(0),
  flags: FT.LOAD_TARGET_MONO,
  renderMode: FT.RENDER_MODE_MONO,
}); // pixelMode: 1, buffer packed 1bpp per |pitch| row, MSB first

face.destroy();
ft.destroy();
```

## API

Two layers:

1. **Convenience** — `FreeType` / `Face` (see [`src/index.d.ts`](./src/index.d.ts)): `newFace`, `setPixelSize`/`setCharSize`, `loadGlyph`, `charIndex`, `selectCharmap`, `kerning`, `info`, `version`.
2. **Raw** — `ft.module` is the full Emscripten module (`ccall`/`cwrap`/`getValue`/`setValue`/`HEAPU8`/`_malloc`/`_free`/`addFunction`). Combined with `ft.offsets` (wasm32 struct field offsets) this reaches **any** FreeType function the convenience layer does not wrap:

```js
const m = ft.module;
const fn = m.cwrap("FT_Some_Function", "number", ["number", "number"]);
const numGlyphs = m.getValue(facePtr + ft.offsets.FT_FaceRec.num_glyphs, "i32");
```

## Supported formats / limitations

**Supported:** TrueType (TTF/TTC), OpenType/CFF (OTF), WOFF, **WOFF2** (Brotli is compiled in), Type1, CFF, plus FreeType's full glyph/outline/bitmap/MONO/AA/kerning/charmap API.

**Not enabled** (niche, require extra external deps; open an issue if needed): bzip2-compressed PCF, embedded PNG in color-bitmap fonts (`sbix`/`CBDT`), and FreeType's internal HarfBuzz auto-hinter assist. Struct offsets are generated for the rendering-common structs (`struct-offsets.json` / `offsets.mjs`); others can be derived the same way.

## Versioning

Tags and npm versions map **1:1 to upstream FreeType**. `vX.Y.Z` and npm version `X.Y.Z` are built from FreeType X.Y.Z.

`vX.Y.Z` is a **rolling pointer to the latest good build of that FreeType version**, not a frozen artifact. A scheduled CI job watches upstream and auto-tags new releases (build + verify gated). If the build scripts/wrapper improve without a FreeType bump, the same `vX.Y.Z` is rebuilt in place (force-moved, no `-N`/synthetic versions) and jsdelivr's tag cache is purged automatically so consumers see the new build promptly.

npm versions are immutable. The first successful `X.Y.Z` publish is retained; rebuilding the same FreeType version safely skips npm while still refreshing the Git tag and jsdelivr. New upstream versions are published automatically with npm provenance.

- **Want the newest good build of a FreeType version** → pin the tag: `@v2.14.3`.
- **Want the immutable npm release** → install `@zkl2333/freetype-wasm@2.14.3`.
- **Want a byte-stable, never-changing artifact** (reproducibility) → pin the **build commit SHA** instead of the tag. jsdelivr and `npm i github:…#<sha>` both accept a commit SHA, and a SHA is immutable by definition. Each build's SHA is printed in its `build-tag` CI log.

To re-release a new build of the same FreeType version: run the **build-tag** workflow manually (Actions → build-tag → Run workflow → enter the version). No local tagging needed.

## Reproducible build

No local toolchain needed:

```bash
docker build -t freetype-wasm .
docker run --rm -v "$PWD/dist:/src/dist" freetype-wasm
node test/test.mjs
```

Pinned to `emscripten/emsdk:3.1.74`; FreeType from GNU Savannah, Brotli from the google/brotli release (`FT_VER` / `BROTLI_VER` overridable). GitHub CI uses the same image for byte-reproducible artifacts.

## License

- This repository's build scripts and JS wrapper: **MIT** (see [LICENSE](./LICENSE)).
- Released `.wasm` embeds FreeType, Brotli, and zlib. Their license texts are included under `dist/licenses/` in every release. FreeType is distributed under the FreeType License (FTL); per the FTL, using the artifact requires crediting FreeType:

  > Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved.
