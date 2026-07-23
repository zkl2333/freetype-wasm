# npm release setup

Releases are built and published only by GitHub Actions. Do not run `npm publish` from a developer machine.

## One-time bootstrap

Trusted publishing cannot create a package for its first release. Bootstrap the scoped package once:

1. Confirm that the npm account `zkl2333` owns the `@zkl2333` scope.
2. Create a short-lived granular npm access token that can publish packages in that scope. Enable publish access and bypass 2FA for this automation token.
3. Add it to the GitHub repository as an Actions secret named `NPM_TOKEN`.
4. Merge the release configuration, then manually run the `build-tag` workflow with `2.14.3`. It builds, tests, creates the immutable build commit, refreshes `v2.14.3`, and publishes `@zkl2333/freetype-wasm@2.14.3` with provenance.

## Switch to trusted publishing

After the first npm version exists:

1. Open the package settings on npm and add a GitHub Actions trusted publisher.
2. Use organization/user `zkl2333`, repository `freetype-wasm`, and workflow file `publish-npm.yml`; allow the `npm publish` action.
3. Remove the `NPM_TOKEN` GitHub secret so the next new version uses OIDC, then set npm publishing access to require 2FA while disallowing tokens. If the next publish reports a trust-configuration error, temporarily restore the bootstrap token while correcting the publisher settings.

The reusable publish workflow requests only `contents: read` and `id-token: write`. It installs a current npm CLI, validates the package, and publishes with npm provenance.

## Subsequent releases

`track-upstream` checks for new FreeType releases every Monday and runs build, verification, tag creation, and npm publication automatically. `build-tag` provides the same path for a manual release or rebuild.

npm versions are immutable. If `@zkl2333/freetype-wasm@X.Y.Z` already exists, the workflow skips npm publication while still refreshing the rolling Git tag and jsdelivr files.
