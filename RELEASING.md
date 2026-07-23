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

The repository must allow the `finalize` job's explicit `contents: write` grant. Protect `v*` tags from deletion or updates after creation. The workflow creates tags with a create-only lease and never force-moves a release tag.

## Version policy

Package versions follow upstream FreeType exactly:

- FreeType `X.Y.Z` is published as npm `X.Y.Z` and immutable Git tag `vX.Y.Z`.
- No package-specific revisions, prerelease suffixes, or synthetic patch versions are used.
- Wrapper/build changes made after `X.Y.Z` has shipped wait for the next upstream FreeType release.
- npm versions and release tags are never overwritten with different artifacts.

`package.json.version` records the current upstream baseline used by ordinary CI and local builds. A scheduled future release updates the manifest only in its tagged build commit; `main` remains source-only.

## Release entry points

The single `publish-npm` workflow supports:

| Trigger | Version | Behaviour |
| --- | --- | --- |
| Monday schedule | Latest strict `X.Y.Z` parsed from GNU Savannah | No-op when the matching immutable tag and npm version already exist; otherwise build and publish. |
| Manual dispatch | Required upstream `version` input | Uses the same path and must run from the default branch. |

Manual example:

```bash
gh workflow run publish-npm.yml \
  --ref main \
  -f version=2.14.3
```

## Permission and artifact boundaries

The release has four isolated jobs:

1. `resolve` has read-only repository access. It resolves one upstream/npm version, checks the immutable Git tag and npm registry, and decides whether this is a new build, a publish retry, or a no-op.
2. `build` has read-only repository access and no persisted checkout credentials. It builds inside the digest-pinned Emscripten image, verifies source signatures and hashes, runs tests/package checks, and uploads only `dist/`.
3. `finalize` alone has `contents: write`. For a new upstream version it completely replaces `dist/` with the verified artifact, creates a build commit, and creates the immutable matching `vX.Y.Z` tag. `main` is not changed.
4. `publish` has read-only repository access plus `id-token: write`. It checks out the exact tagged commit, revalidates the version and package contents, confirms the remote tag still points to that commit, rechecks npm immutability, and publishes with provenance through Trusted Publisher OIDC.

The build and finalize jobs share only a run-scoped GitHub Actions artifact. The package checker rejects unexpected `dist/` files, symlinks, stale wrapper copies, invalid WASM, and version mismatches. Global release concurrency prevents two workflows from publishing at once.

## Failure and retry behavior

- A resolve, build, or test failure changes neither Git tags nor npm.
- A finalize failure stops before npm publication.
- If finalization creates the tag but npm publication fails, rerun the workflow with the same upstream version. It validates and publishes the existing tag without rebuilding or moving it.
- If both the tag and npm version already exist, the workflow is a successful no-op.
- If npm exists without its immutable tag, the workflow fails closed for manual investigation.
