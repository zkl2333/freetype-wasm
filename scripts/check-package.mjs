import { readFileSync, readdirSync, statSync } from "node:fs";

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
  "dist/licenses/Bzip2-LICENSE.txt",
  "dist/licenses/libpng-LICENSE.txt",
  "dist/licenses/zlib-LICENSE.txt",
  "dist/licenses/Emscripten-LICENSE.txt",
  "dist/licenses/musl-COPYRIGHT.txt",
  "dist/licenses/compiler-rt-LICENSE.txt",
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
  throw new Error(`package version must be strict SemVer X.Y.Z: ${pkg.version}`);
}
if (!/^\d+\.\d+\.\d+$/.test(pkg.freetypeVersion)) {
  throw new Error(`freetypeVersion must be a strict X.Y.Z version: ${pkg.freetypeVersion}`);
}
if (process.env.PKG_VER && pkg.version !== process.env.PKG_VER) {
  throw new Error(`package version mismatch: expected ${process.env.PKG_VER}, got ${pkg.version}`);
}
if (process.env.FT_VER && pkg.freetypeVersion !== process.env.FT_VER) {
  throw new Error(`FreeType version mismatch: expected ${process.env.FT_VER}, got ${pkg.freetypeVersion}`);
}

for (const file of expectedFiles) {
  if (statSync(new URL(`../${file}`, import.meta.url)).size === 0) {
    throw new Error(`release file is empty: ${file}`);
  }
}

function listReleaseFiles(directory, prefix) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`release directory must not contain symlinks: ${relative}`);
    }
    if (entry.isDirectory()) {
      files.push(...listReleaseFiles(new URL(`${entry.name}/`, directory), relative));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`unsupported release entry: ${relative}`);
    }
  }
  return files;
}

const expectedDistFiles = expectedFiles.filter((file) => file.startsWith("dist/")).sort();
const actualDistFiles = listReleaseFiles(new URL("../dist/", import.meta.url), "dist").sort();
const unexpectedDistFiles = actualDistFiles.filter((file) => !expectedDistFiles.includes(file));
if (unexpectedDistFiles.length > 0 || actualDistFiles.length !== expectedDistFiles.length) {
  throw new Error(`dist/ contents differ from the release allowlist: ${unexpectedDistFiles.join(", ")}`);
}

for (const file of ["index.mjs", "index.d.ts"]) {
  const source = readFileSync(new URL(`../src/${file}`, import.meta.url));
  const built = readFileSync(new URL(`../dist/${file}`, import.meta.url));
  if (!source.equals(built)) {
    throw new Error(`dist/${file} is stale or does not match src/${file}`);
  }
}

const wasmMagic = readFileSync(new URL("../dist/freetype.wasm", import.meta.url)).subarray(0, 4);
if (!wasmMagic.equals(Buffer.from([0x00, 0x61, 0x73, 0x6d]))) {
  throw new Error("dist/freetype.wasm is not a WebAssembly binary");
}

console.log(`package ready: ${pkg.name}@${pkg.version} (FreeType ${pkg.freetypeVersion})`);
