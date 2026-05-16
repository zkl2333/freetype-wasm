#!/usr/bin/env bash
# 把 FreeType 编成内存可增长、Node+浏览器都能用的 WASM 模块，
# 暴露完整 FreeType 公共 C API + Emscripten 运行时助手。
# 在 emscripten/emsdk 环境跑（Dockerfile / GitHub CI）。本机无 emcc 时别直接跑。
#
# 相对 npm 上停滞的 freetype-wasm 的关键修复：ALLOW_MEMORY_GROWTH=1
#   → 能加载 4MB+ 的 CJK 字体而不 OOM。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FT_VER="${FT_VER:-2.14.3}"
OUT_DIR="${OUT_DIR:-$SCRIPT_DIR/dist}"
WORK="${WORK:-/tmp/ftwasm-build}"
mkdir -p "$WORK" "$OUT_DIR"
# Hermetic output: empty dist/ contents first so a checked-out build commit's
# (or a stale local) artifacts can never leak into the committed tag. Clears
# contents only, not the dir itself (it may be a docker bind mount).
find "$OUT_DIR" -mindepth 1 -delete 2>/dev/null || true
cd "$WORK"

echo ">>> FreeType ${FT_VER}（GNU Savannah，不依赖 github 直连）"
if [ ! -d "freetype-${FT_VER}" ]; then
  curl -fL "https://download.savannah.gnu.org/releases/freetype/freetype-${FT_VER}.tar.gz" -o ft.tar.gz
  tar xf ft.tar.gz
fi
FT_SRC="$WORK/freetype-${FT_VER}"
FT_INC="$FT_SRC/include"

# 1) 先把 brotli 解码器编成 wasm 静态库（FreeType 不自带 brotli；WOFF2 需要它）
BROTLI_VER="${BROTLI_VER:-1.1.0}"
BROTLI_PREFIX="$WORK/brotli-prefix"
echo ">>> brotli ${BROTLI_VER}（WOFF2 依赖）"
if [ ! -d "brotli-${BROTLI_VER}" ]; then
  curl -fL "https://github.com/google/brotli/archive/refs/tags/v${BROTLI_VER}.tar.gz" -o brotli.tar.gz
  tar xf brotli.tar.gz
fi
BR_SRC="$WORK/brotli-${BROTLI_VER}/c"
mkdir -p "$BROTLI_PREFIX/lib" "$BROTLI_PREFIX/include"
cp -r "$BR_SRC/include/brotli" "$BROTLI_PREFIX/include/"
( cd "$WORK/brotli-${BROTLI_VER}"
  mkdir -p obj
  # 解码 WOFF2 只需 common + dec
  for f in $(ls "$BR_SRC"/common/*.c "$BR_SRC"/dec/*.c); do
    emcc -O3 -I"$BR_SRC/include" -c "$f" -o "obj/$(basename "${f%.c}").o"
  done
  emar rcs "$BROTLI_PREFIX/lib/libbrotlidec.a" obj/*.o
  cp "$BROTLI_PREFIX/lib/libbrotlidec.a" "$BROTLI_PREFIX/lib/libbrotlicommon.a"
)

# 2) emscripten 交叉编译 libfreetype.a
#    开：zlib（FreeType 自带 gzip，零外部依赖，给 WOFF1 + 压缩表）
#        brotli（上面编好，给 WOFF2）
#    关（冷门、需额外外部依赖，README 注明）：bzip2 / png(内嵌彩色位图) / harfbuzz(FT 内部 autohint)
cd "$FT_SRC"
emcmake cmake -B build -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DFT_DISABLE_ZLIB=OFF \
  -DFT_DISABLE_BZIP2=ON \
  -DFT_DISABLE_PNG=ON \
  -DFT_DISABLE_HARFBUZZ=ON \
  -DFT_DISABLE_BROTLI=OFF \
  -DFT_REQUIRE_BROTLI=ON \
  -DBROTLIDEC_INCLUDE_DIRS="$BROTLI_PREFIX/include" \
  -DBROTLIDEC_LIBRARIES="$BROTLI_PREFIX/lib/libbrotlidec.a"
emmake make -C build -j"$(nproc)" freetype
FT_LIB="$FT_SRC/build/libfreetype.a"

# 2) 抽公共 API 候选名 → 与 libfreetype.a 实际定义符号取交集 → 最终 EXPORTED_FUNCTIONS
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
emcc "$FT_LIB" "$BROTLI_PREFIX/lib/libbrotlidec.a" \
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
