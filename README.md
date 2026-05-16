# freetype-wasm

A correctly-built, general-purpose WebAssembly build of [FreeType](https://freetype.org/): memory-growable (loads multi-MB CJK fonts), exposes the **complete FreeType public C API**, works in Node and the browser, versioned to upstream FreeType.

[中文说明 → README.zh-CN.md](./README.zh-CN.md)

> Not published to npm. Grab prebuilt artifacts from [GitHub Releases](../../releases), or build it yourself with Docker.

## Why this exists

The only general "FreeType → WASM" package on npm, [`freetype-wasm`](https://www.npmjs.com/package/freetype-wasm), has been unmaintained since 2022. Its prebuilt `.wasm` is compiled **without `ALLOW_MEMORY_GROWTH`** and with a fixed ~16 MB heap that cannot be raised from JS, so loading a multi-MB CJK font aborts with `Aborted(OOM)` (CJK fonts have large glyph/charmap tables; FreeType's allocations scale accordingly).

That is a packaging problem, not a FreeType bug. The other options don't fill this niche either: HarfBuzz-WASM shapes but does not rasterize, CanvasKit is Skia (anti-aliased, no hinted 1-bit), fontkit/opentype.js have no hinting, `freetype2` is a native node-gyp addon rather than WASM.

This repository does the build correctly:

- **`ALLOW_MEMORY_GROWTH=1`** — multi-MB CJK fonts no longer OOM (the core fix).
- Exposes the **complete FreeType public C API** (every `FT_EXPORT` symbol that exists in the build, derived from the headers and intersected with the actual library — not a hand-picked slice), plus Emscripten runtime helpers and wasm32 struct offsets, so callers can reach any FreeType function.
- A thin JS wrapper (`FreeType` / `Face`) covers the common path. MONO vs. anti-aliased rendering is chosen by the caller via load flags — this library does not decide for you.
- Node and browser (`ENVIRONMENT=node,web`).
- Reproducible build; release tags track upstream FreeType versions.

Background story: <https://blog.zkl2333.com/posts/eink-render-pure-node/>

## Install

No npm publish. Pick one (`<tag>` e.g. `v2.13.3-1`, which equals the FreeType version):

- **jsdelivr** (browser/Deno, ESM):
  `import initFreeType, { FT } from "https://cdn.jsdelivr.net/gh/zkl2333/freetype-wasm@<tag>/dist/index.mjs"`
- **npm from GitHub** (Node bundlers):
  `npm i github:zkl2333/freetype-wasm#<tag>` → `import initFreeType, { FT } from "freetype-wasm"`
- **Release tarball**: download `freetype-wasm-<tag>.tar.gz` from [Releases](../../releases) and unpack — a self-contained `dist/`.

The `dist/` (wasm + glue + wrapper) is committed into each release tag by CI, so jsdelivr/`/gh/` and git-install resolve it directly.

## Quick start

```js
import initFreeType, { FT } from "./dist/index.mjs"; // or the jsdelivr / package URL above

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

Release tags track upstream FreeType, and `package.json` `version` is stamped to match:

- `vX.Y.Z` → built from FreeType X.Y.Z (`package.json` version `X.Y.Z`)
- `vX.Y.Z-N` → still FreeType X.Y.Z, packaging/wrapper-only revision `N` (version `X.Y.Z-N`)

Pin a tag in the jsdelivr URL / git-install ref to lock a FreeType version.

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
- Released `.wasm` embeds FreeType and Brotli. FreeType is under the FreeType License (FTL) / GPLv2; Brotli is MIT. Per the FTL, using the artifact requires crediting FreeType:

  > Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved.
