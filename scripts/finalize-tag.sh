#!/usr/bin/env bash
# Build a specific upstream FreeType version, verify it, and bake dist/ +
# the synced version number into the matching tag.
#
# Tags map 1:1 to upstream FreeType: FT_VER=2.14.3 -> tag v2.14.3,
# package.json version 2.14.3. There are no -N revision tags, and we never
# push to main (main stays pure source; dist only lives in the tag's build
# commit). If build/verify fails, set -e aborts -> bad artifacts never reach a tag.
#
# Usage (inside CI container): FT_VER=2.14.3 bash scripts/finalize-tag.sh
set -euo pipefail

: "${FT_VER:?need FT_VER, e.g. 2.14.3}"
TAG="v${FT_VER}"

echo ">>> finalize $TAG (FreeType $FT_VER)"

FT_VER="$FT_VER" bash build.sh
FT_VER="$FT_VER" node test/test.mjs

# Sync the version into package.json (kept equal to the tag / upstream).
FT_VER="$FT_VER" node -e 'const f="package.json";const j=JSON.parse(require("fs").readFileSync(f));j.version=process.env.FT_VER;require("fs").writeFileSync(f,JSON.stringify(j,null,2)+"\n")'
grep '"version"' package.json

# In the container the repo owner differs from the git user, otherwise:
# fatal: not in a git directory.
git config --global --add safe.directory "*"
git config user.email "github-actions[bot]@users.noreply.github.com"
git config user.name  "github-actions[bot]"

# dist/ is gitignored; -f forces it into a build commit referenced only by this tag.
git add -f dist package.json
git commit -m "build: ${TAG} artifacts (FreeType ${FT_VER})"
git tag -f "${TAG}"
git push -f origin "refs/tags/${TAG}"
echo ">>> baked dist into ${TAG} and pushed (main untouched)"
