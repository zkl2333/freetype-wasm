#!/usr/bin/env bash
# 构建指定上游 FreeType 版本，验证，并把 dist/ + 同步后的版本号固化进对应 tag。
#
# tag 与上游 FreeType 1:1：FT_VER=2.14.3 → tag v2.14.3，package.json version 2.14.3。
# 不存在 -N 修订 tag，也不往 main 推（main 保持纯源码；dist 只活在 tag 的构建提交里）。
# 构建/验证不过则 set -e 直接失败 → 坏产物不会进 tag。
#
# 用法（CI 容器内）: FT_VER=2.14.3 bash scripts/finalize-tag.sh
set -euo pipefail

: "${FT_VER:?需要 FT_VER，如 2.14.3}"
TAG="v${FT_VER}"

echo ">>> finalize $TAG（FreeType $FT_VER）"

FT_VER="$FT_VER" bash build.sh
node test/test.mjs

# 版本号同步上游（盖进 package.json，与 tag/上游一致）
FT_VER="$FT_VER" node -e 'const f="package.json";const j=JSON.parse(require("fs").readFileSync(f));j.version=process.env.FT_VER;require("fs").writeFileSync(f,JSON.stringify(j,null,2)+"\n")'
grep '"version"' package.json

# 容器里 repo 属主与 git 用户常不一致，否则 fatal: not in a git directory
git config --global --add safe.directory "*"
git config user.email "github-actions[bot]@users.noreply.github.com"
git config user.name  "github-actions[bot]"

# dist/ 被 .gitignore 忽略，-f 强制塞进“只被该 tag 引用”的构建提交
git add -f dist package.json
git commit -m "build: ${TAG} 产物（FreeType ${FT_VER}）"
git tag -f "${TAG}"
git push -f origin "refs/tags/${TAG}"
echo ">>> 已把 dist 固化进 ${TAG} 并推送（未触碰 main）"
