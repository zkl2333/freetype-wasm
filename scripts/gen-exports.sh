#!/usr/bin/env bash
# 从 FreeType 公共头里抽出所有 FT_EXPORT 声明的函数名，
# 生成 emcc 的 EXPORTED_FUNCTIONS 列表（每个加下划线前缀，外加 _malloc/_free）。
# 这样产物暴露 *完整的 FreeType 公共 C API*，不靠手绑、也不靠 EXPORT_ALL 把内部符号一起带出。
#
# 注意：FreeType 头里 `FT_EXPORT( 返回类型 )` 与函数名经常跨行，
# 所以先把所有头拼平成一行再正则，别用行模式 grep。
set -euo pipefail

FT_INC="${1:?用法: gen-exports.sh <freetype/include 目录> <输出文件>}"
OUT="${2:?用法: gen-exports.sh <freetype/include 目录> <输出文件>}"

names="$(
  find "$FT_INC" -name '*.h' -print0 \
    | xargs -0 cat \
    | tr '\n\t' '  ' \
    | grep -oE 'FT_EXPORT\(\s*[^)]*\)\s*[A-Za-z_][A-Za-z0-9_]*' \
    | sed -E 's/.*\)\s*([A-Za-z_][A-Za-z0-9_]*)$/\1/' \
    | grep -E '^(FT|FTC|TT|PS|CID|BDF|PFR)[A-Za-z0-9_]*$' \
    | sort -u
)"

cnt="$(printf '%s\n' "$names" | grep -c . || true)"
if [ -z "$names" ] || [ "$cnt" -lt 50 ]; then
  echo "!! 只抽到 ${cnt} 个 FT_EXPORT 函数，FreeType 头结构可能变了，检查 $FT_INC" >&2
  exit 1
fi

{
  printf '['
  printf '"_malloc","_free"'
  while IFS= read -r fn; do
    [ -z "$fn" ] && continue
    printf ',"_%s"' "$fn"
  done <<< "$names"
  printf ']'
} > "$OUT"

echo ">>> 抽出 ${cnt} 个 FreeType 公共函数 → $OUT" >&2
