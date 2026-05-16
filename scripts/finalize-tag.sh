#!/usr/bin/env bash
# Build a specific upstream FreeType version, verify it, and bake dist/ +
# the synced version number into the matching tag.
#
# Model:
#   - Tags map 1:1 to upstream FreeType (FT_VER=2.14.3 -> tag v2.14.3,
#     package.json version 2.14.3). No -N revision tags.
#   - vX.Y.Z is a ROLLING pointer to the latest build of that FreeType
#     version (force-moved on every rebuild). Consumers who want a
#     byte-stable pin use the build commit SHA printed below instead.
#   - main is never touched; dist only lives in the tag's build commit.
#   - After force-moving the tag we purge jsdelivr, which otherwise caches
#     @tag as immutable (~12 months) and would keep serving stale bytes.
#
# If build/verify fails, set -e aborts -> bad artifacts never reach a tag.
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
SHA="$(git rev-parse HEAD)"
git tag -f "${TAG}"
git push -f origin "refs/tags/${TAG}"
echo ">>> baked dist into ${TAG} @ ${SHA} (immutable pin) and pushed; main untouched"

# Refresh jsdelivr's @tag cache (the SHA above stays immutable regardless).
SLUG="$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
for f in index.mjs freetype.wasm freetype.mjs offsets.mjs struct-offsets.json index.d.ts; do
  if curl -fsS "https://purge.jsdelivr.net/gh/${SLUG}@${TAG}/dist/${f}" >/dev/null; then
    echo ">>> purged jsdelivr ${TAG}/dist/${f}"
  else
    echo "!! jsdelivr purge skipped for ${f} (non-fatal; cache expires anyway)"
  fi
done
