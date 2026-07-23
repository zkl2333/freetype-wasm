#!/usr/bin/env bash
# Build and verify one package release, then bake dist/ into its immutable tag.
#
# Model:
#   - Package SemVer and the bundled FreeType version are independent.
#   - vX.Y.Z is the immutable package release tag, never a rolling pointer.
#   - main is never touched; dist only lives in the tag's build commit.
#
# If build/verify fails, set -e aborts -> bad artifacts never reach a tag.
#
# Usage:
#   build + bake: PKG_VER=3.0.0 FT_VER=2.14.3 bash scripts/finalize-tag.sh
#   bake only: PKG_VER=3.0.0 FT_VER=2.14.3 PREBUILT_DIST=1 bash scripts/finalize-tag.sh
set -euo pipefail

: "${PKG_VER:?need PKG_VER, e.g. 3.0.0}"
: "${FT_VER:?need FT_VER, e.g. 2.14.3}"
if ! [[ "$PKG_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "!! PKG_VER must be strict SemVer X.Y.Z: $PKG_VER" >&2
  exit 1
fi
if ! [[ "$FT_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "!! FT_VER must be a strict X.Y.Z version: $FT_VER" >&2
  exit 1
fi
TAG="v${PKG_VER}"

echo ">>> finalize $TAG (package $PKG_VER, FreeType $FT_VER)"

if [ "${PREBUILT_DIST:-0}" != "1" ]; then
  FT_VER="$FT_VER" bash build.sh
  FT_VER="$FT_VER" node test/test.mjs
else
  echo ">>> using prebuilt dist/ from the isolated build job"
fi

# Bake both independently versioned release coordinates into the manifest.
PKG_VER="$PKG_VER" FT_VER="$FT_VER" node -e '
  const fs = require("node:fs");
  const file = "package.json";
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  pkg.version = process.env.PKG_VER;
  pkg.freetypeVersion = process.env.FT_VER;
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
'
PKG_VER="$PKG_VER" FT_VER="$FT_VER" node scripts/check-package.mjs
npm pack --ignore-scripts --dry-run

git config user.email "github-actions[bot]@users.noreply.github.com"
git config user.name  "github-actions[bot]"

# dist/ is gitignored; -f forces it into a build commit referenced only by this tag.
git add -f dist package.json
git commit --allow-empty -m "build: ${TAG} artifacts (FreeType ${FT_VER})"
SHA="$(git rev-parse HEAD)"
git tag "${TAG}" "${SHA}"
git push --force-with-lease="refs/tags/${TAG}:" origin "refs/tags/${TAG}"
echo ">>> baked dist into immutable ${TAG} @ ${SHA}; main untouched"
