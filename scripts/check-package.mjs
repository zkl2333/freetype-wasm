import { readFileSync, statSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const expectedFiles = [
  "dist/index.mjs",
  "dist/index.d.ts",
  "dist/freetype.mjs",
  "dist/freetype.wasm",
  "dist/offsets.mjs",
  "dist/struct-offsets.json",
  "dist/licenses/FreeType-LICENSE.txt",
  "dist/licenses/FreeType-FTL.txt",
  "dist/licenses/Brotli-LICENSE.txt",
  "dist/licenses/zlib-LICENSE.txt",
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
];

if (pkg.name !== "@zkl2333/freetype-wasm") {
  throw new Error(`unexpected package name: ${pkg.name}`);
}
if (pkg.private) {
  throw new Error("package.json must not be private");
}
if (pkg.publishConfig?.access !== "public" || pkg.publishConfig?.provenance !== true) {
  throw new Error("publishConfig must require public access and provenance");
}
if (pkg.publishConfig?.registry !== "https://registry.npmjs.org/") {
  throw new Error(`unexpected publish registry: ${pkg.publishConfig?.registry}`);
}
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
  throw new Error(`version must match the FreeType X.Y.Z version: ${pkg.version}`);
}

for (const file of expectedFiles) {
  if (statSync(new URL(`../${file}`, import.meta.url)).size === 0) {
    throw new Error(`release file is empty: ${file}`);
  }
}

console.log(`package ready: ${pkg.name}@${pkg.version}`);
