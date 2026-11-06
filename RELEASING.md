# Releasing

Pushing a version tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml). It checks that the tag matches the package versions and the changelog, runs typecheck, tests and build, packs the packages with pnpm, checks the tarballs, publishes them to npm with provenance and creates the GitHub Release from `CHANGELOG.md`.

Only `@lazy-ease/react` is published. `@lazy-ease/server` stays off npm until it is added to `PACKAGES` in the workflow (see [Publishing @lazy-ease/server](#publishing-lazy-easeserver)).

## Steps

1. Bump `version` in `packages/react/package.json` and `packages/server/package.json`. Both packages are versioned together.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`, add a new empty `## [Unreleased]` above it, and update the link references at the bottom:

   ```md
   [Unreleased]: https://github.com/mikekuss/lazy-ease/compare/vx.y.z...HEAD
   [x.y.z]: https://github.com/mikekuss/lazy-ease/compare/vPREVIOUS...vx.y.z
   ```

3. Merge that to `main` and wait for CI.
4. Tag the merge commit on `main` and push the tag:

   ```bash
   git switch main && git pull
   git tag -a vx.y.z -m "lazy-ease x.y.z"
   git push origin vx.y.z
   ```

5. Watch the Release run under Actions. When it is done, the version is on npm with a provenance badge and the GitHub Release exists.

The run fails before anything is published if the tag isn't `v` plus the `version` of each published package, if the changelog has no `## [x.y.z]` section, or if a packed `package.json` still has a `source` export condition.

A version with a pre-release part (`1.0.0-rc.1`) is published under the npm dist-tag `next` and marked as a pre-release on GitHub.

Re-running a failed run is safe: versions that are already on npm are skipped, and an existing GitHub Release for the tag is left as it is. To change the code of a release, bump the version instead; npm doesn't allow publishing a version twice.

To try the workflow without publishing, run it from the Actions tab (Release → Run workflow). That is a dry run: it runs `pnpm publish --dry-run` (skipped if the version is already on npm) and creates no release.

## One-time setup on npmjs.com

The workflow uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers): npm accepts an OIDC token from this workflow, so there is no `NPM_TOKEN` secret. Each package needs it configured once:

1. On npmjs.com, open `@lazy-ease/react` → Settings → Trusted Publisher → GitHub Actions.
2. Enter organization or user `mikekuss`, repository `lazy-ease`, workflow filename `release.yml`. Leave the environment empty. The fields are case-sensitive, and npm checks them only when publishing.
3. Under allowed actions, allow `npm publish`. Trusted publishers created after 2026-09-03 start with staged publishing only, and this workflow publishes directly.
4. After the first release from the workflow, consider setting Publishing access to "Require two-factor authentication and disallow tokens". Trusted Publishing keeps working.

An `ENEEDAUTH` error in the Publish step means the trusted publisher doesn't match the repository, workflow filename or allowed actions.

`repository.url` in each `package.json` must stay `git+https://github.com/mikekuss/lazy-ease.git`. npm compares it with the repository the token comes from.

## Publishing @lazy-ease/server

1. Publish the first version by hand, since a trusted publisher can only be added to a package that exists: `pnpm build`, then `pnpm publish --access public` in `packages/server` (pnpm, not npm: only pnpm applies `publishConfig.exports`).
2. Add the trusted publisher for `@lazy-ease/server` as above.
3. Add `packages/server` to `PACKAGES` in `release.yml` and remove "isn't on npm yet" from the READMEs.
