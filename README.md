# freetype-wasm

A general-purpose WebAssembly build of [FreeType](https://freetype.org/): memory-growable (loads multi-MB CJK fonts), exposes the **complete FreeType public C API**, and works in Node, browsers, and module Workers.

[中文说明 → README.zh-CN.md](./README.zh-CN.md)

Published on npm as [`@zkl2333/freetype-wasm`](https://www.npmjs.com/package/@zkl2333/freetype-wasm). Git tags and jsdelivr remain available for version-pinned or no-bundler use.

## Why this exists

The only general "FreeType → WASM" package on npm, [`freetype-wasm`](https://www.npmjs.com/package/freetype-wasm), has been unmaintained since 2022. Its prebuilt `.wasm` is compiled **without `ALLOW_MEMORY_GROWTH`** and with a fixed ~16 MB heap that cannot be raised from JS, so loading a multi-MB CJK font aborts with `Aborted(OOM)` (CJK fonts have large glyph/charmap tables; FreeType's allocations scale accordingly).

That OOM is a build-config problem, not a FreeType bug. No other library fills the same need either: FreeType-quality hinted rasterization (both 1-bit MONO and AA) as WASM, in Node and the browser. HarfBuzz-WASM only shapes text, it does not rasterize; CanvasKit is Skia, anti-aliased only with no hinted 1-bit; fontkit and opentype.js do not hint; the `freetype2` npm package is a native node-gyp addon, not WASM.

What this build provides:

- **`ALLOW_MEMORY_GROWTH=1`**: multi-MB CJK fonts no longer OOM.
- Exposes the **complete FreeType public C API**: every `FT_EXPORT` symbol present in the build, taken from the headers and intersected with the actual library (not a hand-picked subset), plus Emscripten runtime helpers and wasm32 struct offsets, so callers can reach any FreeType function.
- A thin JS wrapper (`FreeType` / `Face`) covers the common path; the caller selects MONO or anti-aliased output via load flags.
- Node, browser, and module Web Worker (`ENVIRONMENT=node,web,worker`).
- Pinned Emscripten image plus signature/hash-verified native sources; immutable release tags are created only after CI verification.

## Install

From npm:

```bash
npm install @zkl2333/freetype-wasm
```

```js
import initFreeType, { FT } from "@zkl2333/freetype-wasm";
```

CI commits `dist/` (wasm + glue + wrapper) into each immutable package release tag. `<tag>` is `v` + the npm package version, for example `v3.0.0`. Alternative distribution routes:

- **npm from GitHub**: `npm i github:zkl2333/freetype-wasm#<tag>`
- **git**: `git clone --branch <tag>` and use `dist/`, or `git archive`.
- **jsdelivr** (optional — browser/Deno, ESM, no bundler):
  `import initFreeType, { FT } from "https://cdn.jsdelivr.net/gh/zkl2333/freetype-wasm@<tag>/dist/index.mjs"`

Available tags: see the [tags page](../../tags). Each tag contains the exact files published to npm.

## Quick start

```js
import initFreeType, { FT } from "@zkl2333/freetype-wasm"; // or the jsdelivr URL above

// Browser: the .wasm is fetched from the same directory automatically.
const ft = await initFreeType();
// Node: const ft = await initFreeType({ wasmBinary: fs.readFileSync("dist/freetype.wasm") });

const face = ft.newFace(fontBytes); // Uint8Array — TTF/OTF/TTC/WOFF/WOFF2/Type1/CFF
face.setPixelSize(48); // 48px height; optional second argument is width

// Anti-aliased grayscale (default)
const aa = face.loadGlyph({ char: "字".codePointAt(0) });
// → { width, rows, pitch, pixelMode: 2, buffer: Uint8Array (8bpp), advance, metrics, ... }

// Hinted 1-bit MONO (for e-ink / pixel displays)
const mono = face.loadGlyph({
  char: "字".codePointAt(0),
  flags: FT.LOAD_TARGET_MONO,
  renderMode: FT.RENDER_MODE_MONO,
}); // pixelMode: 1, buffer packed 1bpp per |pitch| row, MSB first

// Bitmap-only sbix/CBDT fonts use a fixed strike and return BGRA pixels.
const colorFace = ft.newFace(colorFontBytes);
colorFace.selectSize(0);
const color = colorFace.loadGlyph({ char: 0x1f603, flags: FT.LOAD_COLOR });
colorFace.destroy();

const metrics = face.sizeMetrics();
for (const { codepoint, glyphIndex } of face.characters()) {
  // Build a coverage map or font atlas; break whenever you have enough.
}

face.destroy();
ft.destroy();
```

The same import works inside a module Worker (`new Worker(url, { type: "module" })`). Each Worker owns an independent FreeType instance and WASM memory. If the generated `.wasm` is hosted somewhere else, pass `locateFile` or `wasmBinary` to `initFreeType`.

## API

Two layers:

1. **Convenience** — `FreeType` / `Face` (see [`src/index.d.ts`](./src/index.d.ts)): `newFace`, `setPixelSize`/`setPixelSizes`/`setCharSize`/`selectSize`, `loadGlyph`, `charIndex`, `characters`, `selectCharmap`, `kerning`, `info`, `sizeMetrics`, `version`, `errorString`.
2. **Raw** — `ft.module` is the full Emscripten module (`ccall`/`cwrap`/`getValue`/`setValue`/`HEAPU8`/`_malloc`/`_free`/`addFunction`). Combined with `ft.offsets` (wasm32 struct field offsets) this reaches **any** FreeType function the convenience layer does not wrap:

```js
const m = ft.module;
const fn = m.cwrap("FT_Some_Function", "number", ["number", "number"]);
const numGlyphs = m.getValue(facePtr + ft.offsets.FT_FaceRec.num_glyphs, "i32");
```

For handles created by the convenience layer, do not change their native reference counts (`FT_Reference_Face` / `FT_Reference_Library`) or call raw `FT_Done_*`; use `face.destroy()` / `ft.destroy()`. Raw calls using those handles must finish before wrapper destruction. If you need custom native ownership, create and manage that face entirely through the raw API.

## Supported formats / limitations

**Supported:** TrueType (TTF/TTC), OpenType/CFF (OTF), WOFF, **WOFF2** (Brotli), bzip2-compressed fonts, embedded-PNG color bitmaps (`sbix`/`CBDT`), Type1, CFF, plus FreeType's glyph/outline/bitmap/MONO/AA/LCD/SDF/kerning/charmap APIs.

**Limitations:** FreeType's internal HarfBuzz auto-hinter assist is not enabled (text shaping is outside FreeType). OT-SVG requires an application-provided SVG renderer. The Emscripten filesystem is disabled; use `newFace(bytes)` rather than file-path APIs. Struct offsets are generated for rendering-common structs (`struct-offsets.json` / `offsets.mjs`); others can be derived the same way.

## Versioning

Package SemVer and the bundled FreeType version are independent. `package.json.version` is the npm/Git release version; `package.json.freetypeVersion` records the upstream library version. Package `3.0.0`, for example, bundles FreeType `2.14.3`.

Both npm versions and `vX.Y.Z` Git tags are immutable and use the package version. Compatible wrapper/build fixes for the same FreeType release increment the package patch; a FreeType upgrade or compatible API addition normally increments the minor; breaking JS or TypeScript API changes increment the major.

Every release is manually started in the **publish-npm** GitHub Actions workflow with both versions. CI verifies source signatures and hashes, builds and tests in isolation, creates the immutable tag, then publishes through npm Trusted Publisher OIDC with provenance. No local `npm publish` or tag creation is needed.

The legacy npm/Git release `2.14.3` remains frozen at its original contents. Users on `^2.14.3` will not cross the package `3.0.0` major automatically.

- **Want the current npm release**: `npm install @zkl2333/freetype-wasm`.
- **Want an immutable Git/jsdelivr release**: pin `v3.0.0` or its commit SHA.

## Repeatable build workflow

No local toolchain needed:

```bash
docker build -t freetype-wasm .
docker run --rm -v "$PWD/dist:/src/dist" freetype-wasm
node test/test.mjs
```

The amd64 Emscripten 3.1.74 image is pinned by digest. FreeType release archives are verified with the vendored official signing key before extraction; zlib, libpng, bzip2, and Brotli archives are pinned by SHA-256. GitHub CI uses the same base image. Live apt packages and CMake are not fully pinned, so this is a repeatable, verified build workflow rather than a byte-for-byte reproducibility guarantee.

## License

- This repository's build scripts and JS wrapper: **MIT** (see [LICENSE](./LICENSE)).
- Released `.wasm` embeds FreeType, Brotli, bzip2, libpng, zlib, musl, compiler-rt, and Emscripten runtime code. Their notices are included under `dist/licenses/` in every release. FreeType is distributed under the FreeType License (FTL); per the FTL, using the artifact requires crediting FreeType:

  > Portions of this software are copyright © The FreeType Project (www.freetype.org). All rights reserved.
