# Release pipeline

Releases are built and published only by GitHub Actions. Do not run `npm publish` locally, create release tags locally, or add an `NPM_TOKEN` secret.

## Trusted Publisher configuration

The npm package must have exactly this GitHub Actions trusted publisher:

- npm package: `@zkl2333/freetype-wasm`
- owner: `zkl2333`
- repository: `freetype-wasm`
- workflow filename: `publish-npm.yml`
- environment: empty
- allowed actions: `npm publish`

npm verifies the top-level workflow filename while exchanging the OIDC identity. Do not rename `.github/workflows/publish-npm.yml` or convert it to a reusable `workflow_call` without updating the npm settings.

The repository must allow the `finalize` job's explicit `contents: write` grant. Protect `v*` tags from deletion or updates after creation. The workflow itself creates tags with a create-only lease and never force-moves a release tag.

## Version policy

Package SemVer and upstream FreeType versions are independent:

- `package.json.version` is the npm version and immutable Git tag (`3.0.0` -> `v3.0.0`).
- `package.json.freetypeVersion` is the FreeType source version compiled into the package.
- Compatible wrapper/build fixes on the same FreeType version increment package patch.
- A FreeType upgrade or compatible API addition normally increments package minor.
- Breaking JS or TypeScript API changes increment package major.

Before a new release, update both manifest fields on `main` as needed and merge the change. Never reuse a package version. The legacy `2.14.3` release predates this split and remains immutable.

## Running a release

Open **Actions -> publish-npm -> Run workflow**, select the default branch, and enter both `package_version` and `freetype_version`. For the first independent release, use package `3.0.0` and FreeType `2.14.3`.

Equivalent GitHub CLI command:

```bash
gh workflow run publish-npm.yml \
  --ref main \
  -f package_version=3.0.0 \
  -f freetype_version=2.14.3
```

The workflow accepts strict `X.Y.Z` values only. For a new tag, the two inputs must match the fields committed on `main`.

## Permission and artifact boundaries

The release has four isolated jobs:

1. `resolve` has read-only repository access. It validates both versions, checks the immutable Git tag and npm registry, and decides whether this is a new build or a publish retry.
2. `build` has read-only repository access and no persisted checkout credentials. It builds inside the digest-pinned Emscripten image, verifies source signatures and hashes, runs tests/package checks, and uploads only `dist/`.
3. `finalize` alone has `contents: write`. For a new version it completely replaces `dist/` with the verified artifact, creates a build commit, and creates the immutable `vX.Y.Z` package tag. `main` is not changed.
4. `publish` has read-only repository access plus `id-token: write`. It checks out the exact tagged commit, revalidates both versions and package contents, confirms the remote tag still points to that commit, rechecks npm immutability, and publishes with provenance through Trusted Publisher OIDC.

The build and finalize jobs share only a run-scoped GitHub Actions artifact. The package checker rejects unexpected `dist/` files, symlinks, stale wrapper copies, invalid WASM, and version mismatches. Global release concurrency prevents two workflows from publishing at once.

## Failure and retry behavior

- A resolve, build, or test failure changes neither Git tags nor npm.
- A finalize failure stops before npm publication.
- If finalization creates the tag but npm publication fails, rerun the workflow with the same two versions. It validates and publishes the existing tag without rebuilding or moving it.
- If both the tag and npm version already exist, the workflow is a successful no-op.
- If npm exists without its immutable tag, the workflow fails closed for manual investigation.
- npm versions and release tags are never overwritten. Publish a new package version for any changed artifact.
