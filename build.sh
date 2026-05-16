#!/usr/bin/env bash
# 把 FreeType 编成内存可增长、Node+浏览器都能用的 WASM 模块，
# 暴露完整 FreeType 公共 C API + Emscripten 运行时助手。
# 在 emscripten/emsdk 环境跑（Dockerfile / GitHub CI）。本机无 emcc 时别直接跑。
#
# 相对 npm 上停滞的 freetype-wasm 的关键修复：ALLOW_MEMORY_GROWTH=1
#   → 能加载 4MB+ 的 CJK 字体而不 OOM。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FT_VER="${FT_VER:-2.13.3}"
OUT_DIR="${OUT_DIR:-$SCRIPT_DIR/dist}"
WORK="${WORK:-/tmp/ftwasm-build}"
mkdir -p "$WORK" "$OUT_DIR"
cd "$WORK"

echo ">>> FreeType ${FT_VER}（GNU Savannah，不依赖 github 直连）"
if [ ! -d "freetype-${FT_VER}" ]; then
  curl -fL "https://download.savannah.gnu.org/releases/freetype/freetype-${FT_VER}.tar.gz" -o ft.tar.gz
  tar xf ft.tar.gz
fi
FT_SRC="$WORK/freetype-${FT_VER}"
FT_INC="$FT_SRC/include"

# 1) emscripten 交叉编译 libfreetype.a（关掉可选外部依赖：自包含、产物小、
#    核心 glyph/outline/bitmap/MONO/AA/kerning/charmap API 全保留；
#    不支持的是 WOFF2/内嵌PNG/zlib压缩字体 —— README 已注明）
cd "$FT_SRC"
emcmake cmake -B build -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DFT_DISABLE_ZLIB=ON \
  -DFT_DISABLE_BZIP2=ON \
  -DFT_DISABLE_PNG=ON \
  -DFT_DISABLE_HARFBUZZ=ON \
  -DFT_DISABLE_BROTLI=ON
emmake make -C build -j"$(nproc)" freetype
FT_LIB="$FT_SRC/build/libfreetype.a"

# 2) 抽完整公共 API 符号列表
bash "$SCRIPT_DIR/scripts/gen-exports.sh" "$FT_INC" "$WORK/exports.json"

# 3) 生成 wasm32 结构体偏移（必须 emcc 编、node 跑，不能本机 gcc）
echo ">>> 生成 struct 偏移（wasm32 ABI）"
# 输出 .cjs：本仓库 package.json 是 type:module，emcc classic 输出含 require/__dirname，
# 用 .cjs 强制 CommonJS，不受 ESM 影响
emcc "$SCRIPT_DIR/scripts/gen-offsets.c" -I"$FT_INC" -O0 \
  -sENVIRONMENT=node -o "$WORK/gen-offsets.cjs"
node "$WORK/gen-offsets.cjs" > "$OUT_DIR/struct-offsets.json"
# 同时产一个 ES module，wrapper 在 Node/浏览器都能直接 import（免 fs/fetch）
printf 'export default %s;\n' "$(cat "$OUT_DIR/struct-offsets.json")" > "$OUT_DIR/offsets.mjs"
echo ">>> struct-offsets.json:" && head -c 120 "$OUT_DIR/struct-offsets.json" && echo

# 4) 链接成通用 WASM 模块
echo ">>> 链接 → freetype.mjs / freetype.wasm"
RUNTIME_METHODS='ccall,cwrap,getValue,setValue,UTF8ToString,stringToUTF8,lengthBytesUTF8,addFunction,removeFunction,HEAPU8,HEAP8,HEAP16,HEAP32,HEAPU16,HEAPU32,HEAPF32'
emcc "$FT_LIB" \
  -O3 \
  --no-entry \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sENVIRONMENT=node,web \
  -sALLOW_MEMORY_GROWTH=1 \
  -sALLOW_TABLE_GROWTH=1 \
  -sINITIAL_MEMORY=16MB \
  -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS=@"$WORK/exports.json" \
  -sEXPORTED_RUNTIME_METHODS="$RUNTIME_METHODS" \
  -o "$OUT_DIR/freetype.mjs"

cp "$SCRIPT_DIR/src/index.mjs" "$OUT_DIR/index.mjs" 2>/dev/null || true
cp "$SCRIPT_DIR/src/index.d.ts" "$OUT_DIR/index.d.ts" 2>/dev/null || true
echo ">>> 产物:" && ls -la "$OUT_DIR"
echo ">>> done. 关键验收：ALLOW_MEMORY_GROWTH=1 → 4MB+ CJK 不再 OOM；完整公共 API 可调"
