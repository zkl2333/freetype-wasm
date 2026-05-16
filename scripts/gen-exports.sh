#!/usr/bin/env bash
# 从 FreeType 公共头里抽出所有 FT_EXPORT 声明的函数名（纯候选名，一行一个）。
# 真正能导出的，由 build.sh 拿这份候选去和 libfreetype.a 实际定义的符号取交集
# —— 自动滤掉 Mac-only / 平台条件未编入 / 宏误抓的，且仍是"本次构建的完整公共 API"。
#
# 注意：FreeType 头里 `FT_EXPORT( 返回类型 )` 与函数名经常跨行，
# 所以先把所有头拼平成一行再正则，别用行模式 grep。
set -euo pipefail

FT_INC="${1:?用法: gen-exports.sh <freetype/include 目录> <输出文件>}"
OUT="${2:?用法: gen-exports.sh <freetype/include 目录> <输出文件>}"

find "$FT_INC" -name '*.h' -print0 \
  | xargs -0 cat \
  | tr '\n\t' '  ' \
  | grep -oE 'FT_EXPORT\(\s*[^)]*\)\s*[A-Za-z_][A-Za-z0-9_]*' \
  | sed -E 's/.*\)\s*([A-Za-z_][A-Za-z0-9_]*)$/\1/' \
  | grep -E '^(FT|FTC|TT|PS|CID|BDF|PFR)[A-Za-z0-9_]*$' \
  | sort -u > "$OUT"

cnt="$(grep -c . "$OUT" || true)"
if [ "$cnt" -lt 50 ]; then
  echo "!! 只抽到 ${cnt} 个 FT_EXPORT 候选，FreeType 头结构可能变了，检查 $FT_INC" >&2
  exit 1
fi
echo ">>> 候选 FreeType 公共函数 ${cnt} 个 → $OUT（待与实际符号取交集）" >&2
