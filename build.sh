#!/usr/bin/env bash
# 把 FreeType 编成内存可增长、Node+浏览器都能用的 WASM 模块，
# 暴露完整 FreeType 公共 C API + Emscripten 运行时助手。
# 在 emscripten/emsdk 环境跑（Dockerfile / GitHub CI）。本机无 emcc 时别直接跑。
#
# 相对 npm 上停滞的 freetype-wasm 的关键修复：ALLOW_MEMORY_GROWTH=1
#   → 能加载 4MB+ 的 CJK 字体而不 OOM。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FT_VER="${FT_VER:-$(node -p 'require(process.argv[1]).freetypeVersion' "$SCRIPT_DIR/package.json")}"
if ! [[ "$FT_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "!! FT_VER 必须是严格的 X.Y.Z: $FT_VER" >&2
  exit 1
fi
OUT_DIR="${OUT_DIR:-$SCRIPT_DIR/dist}"
WORK="${WORK:-/tmp/ftwasm-build}"
mkdir -p "$WORK" "$OUT_DIR"
WORK="$(cd "$WORK" && pwd -P)"
OUT_DIR="$(cd "$OUT_DIR" && pwd -P)"
if [ "$OUT_DIR" = "/" ] || [ "$OUT_DIR" = "$SCRIPT_DIR" ] || [[ "$SCRIPT_DIR/" == "$OUT_DIR/"* ]]; then
  echo "!! 拒绝清空危险的 OUT_DIR: $OUT_DIR" >&2
  exit 1
fi
# Hermetic output: empty dist/ contents first so a checked-out build commit's
# (or a stale local) artifacts can never leak into the committed tag. Clears
# contents only, not the dir itself (it may be a docker bind mount).
find "$OUT_DIR" -mindepth 1 -delete
cd "$WORK"

FT_SRC="$WORK/freetype-${FT_VER}"
FT_INC="$FT_SRC/include"
FT_ARCHIVE="$WORK/freetype-${FT_VER}.tar.gz"
FT_SIGNATURE="${FT_ARCHIVE}.sig"
FT_SIGNING_KEY="$SCRIPT_DIR/scripts/keys/freetype-release.asc"
FT_KEYRING="$WORK/freetype-release.gpg"
FT_GPG_STATUS="$WORK/freetype-${FT_VER}.gpgv-status"
FT_SIGNING_FINGERPRINT="E30674707856409FF1948010BE6C3AAC63AD8E3F"

echo ">>> FreeType ${FT_VER}（Savannah 发布包，RSA 签名验证）"
if ! command -v gpg >/dev/null || ! command -v gpgv >/dev/null; then
  echo "!! 构建 FreeType 需要 gpg 与 gpgv" >&2
  exit 1
fi
if [ ! -f "$FT_SIGNING_KEY" ]; then
  echo "!! FreeType 发布公钥缺失: $FT_SIGNING_KEY" >&2
  exit 1
fi
gpg --batch --yes --dearmor --output "$FT_KEYRING" "$FT_SIGNING_KEY"

if [ ! -f "$FT_ARCHIVE" ] || [ ! -f "$FT_SIGNATURE" ]; then
  downloaded=0
  for base_url in \
    "https://download.savannah.gnu.org/releases/freetype" \
    "https://download-mirror.savannah.gnu.org/releases/freetype"; do
    echo ">>> 下载 $base_url/freetype-${FT_VER}.tar.gz"
    if curl -fL --retry 3 --retry-all-errors \
         "$base_url/freetype-${FT_VER}.tar.gz" -o "${FT_ARCHIVE}.tmp" && \
       curl -fL --retry 3 --retry-all-errors \
         "$base_url/freetype-${FT_VER}.tar.gz.sig" -o "${FT_SIGNATURE}.tmp"; then
      mv "${FT_ARCHIVE}.tmp" "$FT_ARCHIVE"
      mv "${FT_SIGNATURE}.tmp" "$FT_SIGNATURE"
      downloaded=1
      break
    fi
  done
  rm -f "${FT_ARCHIVE}.tmp" "${FT_SIGNATURE}.tmp"
  if [ "$downloaded" != "1" ]; then
    echo "!! FreeType 主站与官方镜像均下载失败" >&2
    exit 1
  fi
fi

if ! gpgv --status-fd=1 --keyring "$FT_KEYRING" \
     "$FT_SIGNATURE" "$FT_ARCHIVE" > "$FT_GPG_STATUS"; then
  cat "$FT_GPG_STATUS" >&2
  echo "!! FreeType ${FT_VER} 发布签名无效" >&2
  exit 1
fi
cat "$FT_GPG_STATUS"
if ! grep -Fq "[GNUPG:] VALIDSIG ${FT_SIGNING_FINGERPRINT} " "$FT_GPG_STATUS"; then
  echo "!! FreeType 发布包并非由预期公钥签发" >&2
  exit 1
fi
sha256sum "$FT_ARCHIVE"

# 每次都从已验签归档重新展开，避免复用 WORK 时信任被改动的源码树。
rm -rf "$FT_SRC"
tar xf "$FT_ARCHIVE" -C "$WORK"
if [ ! -d "$FT_SRC" ] || [ ! -f "$FT_SRC/CMakeLists.txt" ]; then
  echo "!! FreeType 归档目录结构异常" >&2
  exit 1
fi

prepare_hashed_source() {
  local label="$1"
  local url="$2"
  local archive="$3"
  local expected_sha256="$4"
  local source_dir="$5"

  if [ ! -f "$archive" ]; then
    curl -fL --retry 3 --retry-all-errors "$url" -o "${archive}.tmp"
    printf '%s  %s\n' "$expected_sha256" "${archive}.tmp" | sha256sum -c -
    mv "${archive}.tmp" "$archive"
  fi
  printf '%s  %s\n' "$expected_sha256" "$archive" | sha256sum -c -
  rm -rf "$source_dir"
  tar xf "$archive" -C "$WORK"
  if [ ! -d "$source_dir" ]; then
    echo "!! ${label} 归档目录结构异常" >&2
    exit 1
  fi
}

validate_dependency_version() {
  local label="$1"
  local version="$2"
  if ! [[ "$version" =~ ^[0-9]+(\.[0-9]+)+$ ]]; then
    echo "!! ${label} 版本号必须只含数字与点: $version" >&2
    exit 1
  fi
}

# Emscripten、musl 和 compiler-rt 的运行时许可来自当前工具链；
# 原生依赖的许可则一律从下面经过哈希校验的源码树复制。
EMSCRIPTEN_ROOT="$(em-config EMSCRIPTEN_ROOT)"
if [ ! -f "$EMSCRIPTEN_ROOT/LICENSE" ] || \
   [ ! -f "$EMSCRIPTEN_ROOT/system/lib/libc/musl/COPYRIGHT" ] || \
   [ ! -f "$EMSCRIPTEN_ROOT/system/lib/compiler-rt/LICENSE.TXT" ]; then
  echo "!! Emscripten、musl 或 compiler-rt 运行时许可证文件缺失" >&2
  exit 1
fi

# 1) zlib 编成 wasm 静态库。不要使用 emsdk 3.1.74 自带的 1.2.13 port；
#    FreeType、libpng 与最终链接都显式指向这一份经过哈希校验的 1.3.2。
ZLIB_VER="${ZLIB_VER:-1.3.2}"
ZLIB_SHA256="${ZLIB_SHA256:-b99a0b86c0ba9360ec7e78c4f1e43b1cbdf1e6936c8fa0f6835c0cd694a495a1}"
validate_dependency_version "zlib" "$ZLIB_VER"
ZLIB_PREFIX="$WORK/zlib-prefix"
ZLIB_SRC="$WORK/zlib-${ZLIB_VER}"
echo ">>> zlib ${ZLIB_VER}（WOFF1 与 PNG 依赖）"
prepare_hashed_source \
  "zlib" \
  "https://github.com/madler/zlib/archive/refs/tags/v${ZLIB_VER}.tar.gz" \
  "$WORK/zlib-${ZLIB_VER}.tar.gz" \
  "$ZLIB_SHA256" \
  "$ZLIB_SRC"
rm -rf "$ZLIB_SRC/build-wasm" "$ZLIB_PREFIX"
emcmake cmake -S "$ZLIB_SRC" -B "$ZLIB_SRC/build-wasm" -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$ZLIB_PREFIX" \
  -DCMAKE_INSTALL_LIBDIR=lib \
  -DBUILD_SHARED_LIBS=OFF \
  -DZLIB_BUILD_SHARED=OFF \
  -DZLIB_BUILD_STATIC=ON \
  -DZLIB_BUILD_TESTING=OFF \
  -DZLIB_INSTALL=ON
cmake --build "$ZLIB_SRC/build-wasm" --parallel "$(nproc)"
cmake --install "$ZLIB_SRC/build-wasm"
ZLIB_INCLUDE_DIR="$ZLIB_PREFIX/include"
ZLIB_LIBRARY="$ZLIB_PREFIX/lib/libz.a"
if [ ! -f "$ZLIB_INCLUDE_DIR/zlib.h" ] || [ ! -f "$ZLIB_LIBRARY" ] || \
   [ ! -f "$ZLIB_SRC/LICENSE" ]; then
  echo "!! zlib 静态构建或许可证缺失" >&2
  exit 1
fi

# 2) libpng 编成 wasm 静态库。固定 emsdk 3.1.74 的 port 仍是 1.6.39，
#    对不可信字体输入过旧，因此显式使用带校验的当前版本。
LIBPNG_VER="${LIBPNG_VER:-1.6.58}"
LIBPNG_SHA256="${LIBPNG_SHA256:-a9d4df463d36a6e5f9c29bd6f4967312d17e996c1854f3511f833924eb1993cf}"
validate_dependency_version "libpng" "$LIBPNG_VER"
LIBPNG_PREFIX="$WORK/libpng-prefix"
PNG_SRC="$WORK/libpng-${LIBPNG_VER}"
echo ">>> libpng ${LIBPNG_VER}（彩色位图）"
prepare_hashed_source \
  "libpng" \
  "https://github.com/pnggroup/libpng/archive/refs/tags/v${LIBPNG_VER}.tar.gz" \
  "$WORK/libpng-${LIBPNG_VER}.tar.gz" \
  "$LIBPNG_SHA256" \
  "$PNG_SRC"
rm -rf "$PNG_SRC/build-wasm" "$LIBPNG_PREFIX"
emcmake cmake -S "$PNG_SRC" -B "$PNG_SRC/build-wasm" -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$LIBPNG_PREFIX" \
  -DPNG_SHARED=OFF \
  -DPNG_STATIC=ON \
  -DPNG_TESTS=OFF \
  -DPNG_TOOLS=OFF \
  -DPNG_EXECUTABLES=OFF \
  -DPNG_HARDWARE_OPTIMIZATIONS=OFF \
  -DZLIB_INCLUDE_DIR="$ZLIB_INCLUDE_DIR" \
  -DZLIB_LIBRARY="$ZLIB_LIBRARY"
cmake --build "$PNG_SRC/build-wasm" --parallel "$(nproc)"
cmake --install "$PNG_SRC/build-wasm"
PNG_LIB="$LIBPNG_PREFIX/lib/libpng16.a"
if [ ! -f "$PNG_LIB" ]; then
  echo "!! libpng 静态库未生成: $PNG_LIB" >&2
  exit 1
fi

# 3) bzip2 1.0.8 编成 wasm 静态库。emsdk 3.1.74 自带的 1.0.6 port
#    未包含 CVE-2019-12900 修复，不能用于解析不可信字体。
BZIP2_VER="${BZIP2_VER:-1.0.8}"
BZIP2_SHA256="${BZIP2_SHA256:-ab5a03176ee106d3f0fa90e381da478ddae405918153cca248e682cd0c4a2269}"
validate_dependency_version "bzip2" "$BZIP2_VER"
BZIP2_PREFIX="$WORK/bzip2-prefix"
BZ_SRC="$WORK/bzip2-${BZIP2_VER}"
echo ">>> bzip2 ${BZIP2_VER}（压缩字体）"
prepare_hashed_source \
  "bzip2" \
  "https://sourceware.org/pub/bzip2/bzip2-${BZIP2_VER}.tar.gz" \
  "$WORK/bzip2-${BZIP2_VER}.tar.gz" \
  "$BZIP2_SHA256" \
  "$BZ_SRC"
rm -rf "$BZ_SRC/obj-wasm" "$BZIP2_PREFIX"
mkdir -p "$BZ_SRC/obj-wasm" "$BZIP2_PREFIX/lib" "$BZIP2_PREFIX/include"
for f in blocksort.c compress.c decompress.c huffman.c randtable.c crctable.c bzlib.c; do
  emcc -O3 -I"$BZ_SRC" -c "$BZ_SRC/$f" -o "$BZ_SRC/obj-wasm/${f%.c}.o"
done
emar rcs "$BZIP2_PREFIX/lib/libbz2.a" "$BZ_SRC"/obj-wasm/*.o
cp "$BZ_SRC/bzlib.h" "$BZIP2_PREFIX/include/"

# 4) 先把 brotli 解码器编成 wasm 静态库（FreeType 不自带 brotli；WOFF2 需要它）
BROTLI_VER="${BROTLI_VER:-1.2.0}"
BROTLI_SHA256="${BROTLI_SHA256:-816c96e8e8f193b40151dad7e8ff37b1221d019dbcb9c35cd3fadbfe6477dfec}"
validate_dependency_version "Brotli" "$BROTLI_VER"
BROTLI_PREFIX="$WORK/brotli-prefix"
BR_ROOT="$WORK/brotli-${BROTLI_VER}"
BR_SRC="$BR_ROOT/c"
echo ">>> brotli ${BROTLI_VER}（WOFF2 依赖）"
prepare_hashed_source \
  "Brotli" \
  "https://github.com/google/brotli/archive/refs/tags/v${BROTLI_VER}.tar.gz" \
  "$WORK/brotli-${BROTLI_VER}.tar.gz" \
  "$BROTLI_SHA256" \
  "$BR_ROOT"
rm -rf "$BROTLI_PREFIX" "$BR_ROOT/obj"
mkdir -p "$BROTLI_PREFIX/lib" "$BROTLI_PREFIX/include"
cp -r "$BR_SRC/include/brotli" "$BROTLI_PREFIX/include/"
( cd "$BR_ROOT"
  mkdir -p obj
  # 解码 WOFF2 只需 common + dec
  for f in "$BR_SRC"/common/*.c "$BR_SRC"/dec/*.c; do
    emcc -O3 -I"$BR_SRC/include" -c "$f" -o "obj/$(basename "${f%.c}").o"
  done
  emar rcs "$BROTLI_PREFIX/lib/libbrotlidec.a" obj/*.o
  cp "$BROTLI_PREFIX/lib/libbrotlidec.a" "$BROTLI_PREFIX/lib/libbrotlicommon.a"
)

# 5) emscripten 交叉编译 libfreetype.a
#    开：zlib（WOFF1 + 压缩表）、brotli（WOFF2）、bzip2、PNG（彩色位图）、错误字符串。
#    关：harfbuzz（仅改善 FreeType 内部 OpenType auto-hint；不是文本 shaping）。
cd "$FT_SRC"
emcmake cmake -B build -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DFT_DISABLE_ZLIB=OFF \
  -DFT_REQUIRE_ZLIB=ON \
  -DZLIB_INCLUDE_DIR="$ZLIB_INCLUDE_DIR" \
  -DZLIB_LIBRARY="$ZLIB_LIBRARY" \
  -DFT_DISABLE_BZIP2=OFF \
  -DFT_REQUIRE_BZIP2=ON \
  -DBZIP2_INCLUDE_DIR="$BZIP2_PREFIX/include" \
  -DBZIP2_LIBRARY_RELEASE="$BZIP2_PREFIX/lib/libbz2.a" \
  -DFT_DISABLE_PNG=OFF \
  -DFT_REQUIRE_PNG=ON \
  -DPNG_PNG_INCLUDE_DIR="$LIBPNG_PREFIX/include" \
  -DPNG_LIBRARY_RELEASE="$PNG_LIB" \
  -DFT_DISABLE_HARFBUZZ=ON \
  -DFT_DISABLE_BROTLI=OFF \
  -DFT_REQUIRE_BROTLI=ON \
  -DFT_ENABLE_ERROR_STRINGS=ON \
  -DBROTLIDEC_INCLUDE_DIRS="$BROTLI_PREFIX/include" \
  -DBROTLIDEC_LIBRARIES="$BROTLI_PREFIX/lib/libbrotlidec.a"
emmake make -C build -j"$(nproc)" freetype
FT_LIB="$FT_SRC/build/libfreetype.a"

for feature in FT_CONFIG_OPTION_USE_ZLIB FT_CONFIG_OPTION_USE_BZIP2 FT_CONFIG_OPTION_USE_PNG FT_CONFIG_OPTION_USE_BROTLI FT_CONFIG_OPTION_ERROR_STRINGS; do
  if ! grep -q "^#define ${feature}" "$FT_SRC/build/include/freetype/config/ftoption.h"; then
    echo "!! ${feature} 未进入最终 FreeType 配置" >&2
    exit 1
  fi
done

# 6) 抽公共 API 候选名 → 与 libfreetype.a 实际定义符号取交集 → 最终 EXPORTED_FUNCTIONS
bash "$SCRIPT_DIR/scripts/gen-exports.sh" "$FT_INC" "$WORK/candidates.txt"
# libfreetype.a 里真实定义的符号（-j 只出符号名，--defined-only 去未定义）
emnm -j --defined-only "$FT_LIB" 2>/dev/null \
  | sed -E 's/^_//' \
  | sort -u > "$WORK/defined.txt"
comm -12 "$WORK/candidates.txt" "$WORK/defined.txt" > "$WORK/final.txt"
fcnt="$(grep -c . "$WORK/final.txt" || true)"
if [ "$fcnt" -lt 50 ]; then
  echo "!! 交集只剩 ${fcnt} 个（候选 $(grep -c . "$WORK/candidates.txt") / 定义 $(grep -c . "$WORK/defined.txt")），异常" >&2
  exit 1
fi
{
  printf '['
  printf '"_malloc","_free"'
  while IFS= read -r fn; do [ -n "$fn" ] && printf ',"_%s"' "$fn"; done < "$WORK/final.txt"
  printf ']'
} > "$WORK/exports.json"
echo ">>> 导出 ${fcnt} 个真实存在的 FreeType 公共函数（候选∩libfreetype.a）" >&2

# 7) 生成 wasm32 结构体偏移（必须 emcc 编、node 跑，不能本机 gcc）
echo ">>> 生成 struct 偏移（wasm32 ABI）"
# 输出 .cjs：本仓库 package.json 是 type:module，emcc classic 输出含 require/__dirname，
# 用 .cjs 强制 CommonJS，不受 ESM 影响
emcc "$SCRIPT_DIR/scripts/gen-offsets.c" -I"$FT_INC" -O0 \
  -sENVIRONMENT=node -o "$WORK/gen-offsets.cjs"
node "$WORK/gen-offsets.cjs" > "$OUT_DIR/struct-offsets.json"
# 同时产一个 ES module，wrapper 在 Node/浏览器都能直接 import（免 fs/fetch）
printf 'export default %s;\n' "$(cat "$OUT_DIR/struct-offsets.json")" > "$OUT_DIR/offsets.mjs"
echo ">>> struct-offsets.json:" && head -c 120 "$OUT_DIR/struct-offsets.json" && echo

# Ship the notices required by the native projects compiled into the WASM.
mkdir -p "$OUT_DIR/licenses"
cp "$FT_SRC/LICENSE.TXT" "$OUT_DIR/licenses/FreeType-LICENSE.txt"
cp "$FT_SRC/docs/FTL.TXT" "$OUT_DIR/licenses/FreeType-FTL.txt"
cp "$WORK/brotli-${BROTLI_VER}/LICENSE" "$OUT_DIR/licenses/Brotli-LICENSE.txt"
cp "$BZ_SRC/LICENSE" "$OUT_DIR/licenses/Bzip2-LICENSE.txt"
cp "$PNG_SRC/LICENSE" "$OUT_DIR/licenses/libpng-LICENSE.txt"
cp "$ZLIB_SRC/LICENSE" "$OUT_DIR/licenses/zlib-LICENSE.txt"
cp "$EMSCRIPTEN_ROOT/LICENSE" "$OUT_DIR/licenses/Emscripten-LICENSE.txt"
cp "$EMSCRIPTEN_ROOT/system/lib/libc/musl/COPYRIGHT" "$OUT_DIR/licenses/musl-COPYRIGHT.txt"
cp "$EMSCRIPTEN_ROOT/system/lib/compiler-rt/LICENSE.TXT" "$OUT_DIR/licenses/compiler-rt-LICENSE.txt"

# 8) 链接成通用 WASM 模块
echo ">>> 链接 → freetype.mjs / freetype.wasm"
RUNTIME_METHODS='ccall,cwrap,getValue,setValue,UTF8ToString,stringToUTF8,lengthBytesUTF8,addFunction,removeFunction,HEAPU8,HEAP8,HEAP16,HEAP32,HEAPU16,HEAPU32,HEAPF32'
emcc "$FT_LIB" "$BZIP2_PREFIX/lib/libbz2.a" "$PNG_LIB" "$BROTLI_PREFIX/lib/libbrotlidec.a" "$ZLIB_LIBRARY" \
  -O3 \
  --no-entry \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=node,web,worker \
  -sALLOW_MEMORY_GROWTH=1 \
  -sALLOW_TABLE_GROWTH=1 \
  -sINITIAL_MEMORY=16MB \
  -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS=@"$WORK/exports.json" \
  -sEXPORTED_RUNTIME_METHODS="$RUNTIME_METHODS" \
  -o "$OUT_DIR/freetype.mjs"

cp "$SCRIPT_DIR/src/index.mjs" "$OUT_DIR/index.mjs"
cp "$SCRIPT_DIR/src/index.d.ts" "$OUT_DIR/index.d.ts"
echo ">>> 产物:" && ls -la "$OUT_DIR"
echo ">>> done. 关键验收：ALLOW_MEMORY_GROWTH=1 → 4MB+ CJK 不再 OOM；完整公共 API 可调"
