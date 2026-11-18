# Releasing

All five packages are released together at one version: `@lazy-ease/core`, `@lazy-ease/react`, `@lazy-ease/server`, `@lazy-ease/testing` and `@lazy-ease/vanilla`. Each `@lazy-ease` dependency is `workspace:*` in the repository, and pnpm packs it as the exact version of the same release, so the packages on npm always match each other.

Pushing a version tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml). It checks that the tag, the package versions and the changelog agree (`scripts/release-check.mjs`), runs typecheck, tests and build, packs every package with pnpm and checks the tarballs, publishes them to npm with provenance, dependencies first, and creates the GitHub Release from `CHANGELOG.md` with the release assets.

## Before every release: the local checks

On the commit you are about to tag:

```bash
pnpm build
pnpm check:release
pnpm check:packages
pnpm check:next
pnpm check:sizes --packed
pnpm check:examples
pnpm test:frames
```

- `check:release`: one version for every package, `workspace:*` for each `@lazy-ease` dependency, the repository URL and access npm needs, and a changelog section. It prints the publication order.
- `check:packages`: packs each package, runs publint and attw, and installs each tarball next to the packed packages it depends on to use every entry point as a consumer would: Node imports without browser globals, the ThumbHash decoder with the real `thumbhash` package, a server render, React server rendering, the self-starting script in jsdom, and a production esbuild bundle in which unused entries leave nothing while the stylesheet and the script stay. It also checks the packed `sideEffects` field itself. It leaves the tarballs in `.cache/packs`.
- `check:next`: builds a Next.js App Router app with npm against those tarballs and checks that it runs on the packed core, byte for byte, and not on a registry copy.
- `check:sizes --packed`: the size budgets in `docs/design-spec.md`, measured on the tarballs with esbuild 0.28.2 (it refuses another version), minified, Brotli 11. `--json <file>` writes the numbers. It is not part of CI. Don't tag a release while it fails.
- `check:examples`: typechecks the complete examples in the READMEs against the built packages.
- `test:frames`: the pixel frame test, below.

To see exactly what would be uploaded, `node scripts/pack.mjs .cache/release` packs every package in publication order into `.cache/release` and writes `release.json` there, and `pnpm publish <tarball> --dry-run` shows what npm would receive.

### The frame test

`pnpm test:frames` starts the demo dev servers (Vite on 5173, the image server on 3001), or reuses them if `pnpm dev` is already running, opens `apps/demo/controller.html` in Chromium and checks that every controller case passes. Then it reruns the fade, placeholder, lazy scroll-root, priority, resize, failed-upgrade and `update()` cases while recording the real screen frames, and fails if any frame shows alt text, a broken-image icon or a blank box between the placeholder and the image. A failing test attaches a contact sheet of the frames to the report (`apps/e2e/playwright-report/frames`, open it with `pnpm --filter e2e exec playwright show-report playwright-report/frames`). How frames are judged is described at the top of `apps/e2e/frames/controller-frames.spec.ts`.

The test is not part of `pnpm test`, `pnpm e2e` or CI: it needs the demo servers, takes about a minute and depends on real frame timing. Don't tag a release while it fails. It needs Chromium for Playwright (`pnpm --filter e2e exec playwright install chromium`).

## Steps

1. Set `version` in every `packages/*/package.json` to the new version. `pnpm check:release` fails while they differ.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [x.y.z] - YYYY-MM-DD`, add a new empty `## [Unreleased]` above it, and update the link references at the bottom:

   ```md
   [Unreleased]: https://github.com/mikekuss/lazy-ease/compare/vx.y.z...HEAD
   [x.y.z]: https://github.com/mikekuss/lazy-ease/compare/vPREVIOUS...vx.y.z
   ```

3. Run the local checks above, merge that to `main` and wait for CI.
4. Tag the merge commit on `main` and push the tag:

   ```bash
   git switch main && git pull
   node scripts/release-check.mjs --tag vx.y.z
   git tag -a vx.y.z -m "lazy-ease x.y.z"
   git push origin vx.y.z
   ```

5. Watch the Release run under Actions. When it is done, every package is on npm with a provenance badge and the GitHub Release exists with its assets.

The run fails before anything is published if the tag isn't `v` plus the shared version, if the changelog has no `## [x.y.z]` section, if a packed `package.json` still has a `source` export condition or needs a `@lazy-ease` package at another version, or if one of the packages doesn't exist on npm yet (see [First publish of a new package](#first-publish-of-a-new-package)).

The packages are published one by one in dependency order: `@lazy-ease/core`, then the packages that need it. If a run stops halfway, npm holds the dependencies but not yet the packages that need them, never the other way round. Re-running a failed run is safe: versions that are already on npm are skipped, and an existing GitHub Release for the tag only gets its assets uploaded again. Re-running only the GitHub Release job works while the `release-assets` artifact is kept (7 days); after that, re-run the whole workflow. To change the code of a release, bump the version instead; npm doesn't allow publishing a version twice.

A version with a pre-release part (`1.0.0-rc.1`) is published under the npm dist-tag `next` and marked as a pre-release on GitHub.

To try the workflow without publishing, run it from the Actions tab (Release → Run workflow). That is a dry run: it accepts a changelog that still says `## [Unreleased]`, runs `pnpm publish --dry-run` (skipped if the version is already on npm), warns about packages that aren't on npm yet and creates no release. The release assets are kept as a workflow artifact.

## Release assets

The GitHub Release for each tag carries:

- the conformance fixtures of `@lazy-ease/testing`: `manifest.json` and every file it lists, byte for byte from the packed tarball (`scripts/fixture-assets.mjs`). Check them against the lengths and SHA-256 sums in `manifest.json` after downloading.
- `release.json`: the version, the commit, and per package the tarball name, size, npm `integrity` (`sha512-…`) and `shasum`, its `@lazy-ease` dependencies and every file with its size and SHA-256. `npm view @lazy-ease/core@x.y.z dist.integrity` prints the same integrity for a version the workflow published.

`release.json` describes the tarballs CI packed. A version published by hand from another machine can have a different integrity on npm, because gzip headers differ between systems. The Publish step warns about each such package, with both values.

## One-time setup on npmjs.com

The workflow uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers): npm accepts an OIDC token from this workflow, so there is no `NPM_TOKEN` secret. It needs npm 11.5.1 or later, which the workflow installs, and a GitHub-hosted runner. Each package needs a trusted publisher, and npm can only add one to a package that already exists:

1. On npmjs.com, open the package → Settings → Trusted Publisher → GitHub Actions.
2. Enter organization or user `mikekuss`, repository `lazy-ease`, workflow filename `release.yml`. Leave the environment empty. The fields are case-sensitive, and npm checks them only when publishing.
3. Under allowed actions, allow `npm publish`. Trusted publishers created after 2026-09-03 start with staged publishing only, and this workflow publishes directly.
4. After the first release from the workflow, consider setting Publishing access to "Require two-factor authentication and disallow tokens". Trusted Publishing keeps working.

An `ENEEDAUTH` error in the Publish step means the trusted publisher doesn't match the repository, workflow filename or allowed actions.

`repository.url` in each `package.json` must stay `git+https://github.com/mikekuss/lazy-ease.git`; npm compares it with the repository the token comes from, and `pnpm check:release` checks it.

### First publish of a new package

Up to 0.2 only `@lazy-ease/react` was on npm. `@lazy-ease/core`, `@lazy-ease/testing`, `@lazy-ease/vanilla` and `@lazy-ease/server` don't exist there yet, so they can't have a trusted publisher, and a tag push fails at "Check that every package exists on npm" before anything is uploaded. Each new package needs one version published by hand first, with pnpm (only pnpm applies `publishConfig.exports` and replaces `workspace:*`), logged in to npm as the owner of the `@lazy-ease` scope with two-factor authentication.

Two ways to do this; pick one before the first 0.3 tag:

- **A bootstrap version (recommended).** Publish a pre-release of the four new packages by hand, for example `0.3.0-bootstrap.0` under the dist-tag `bootstrap` (set that version in every `packages/*/package.json` locally, `pnpm build`, `node scripts/pack.mjs .cache/bootstrap`, `pnpm publish <tarball> --tag bootstrap` for each, then discard the version change), add the trusted publishers, then tag `v0.3.0`. The workflow publishes all five packages at 0.3.0 with provenance, and the bootstrap versions can be deprecated with `npm deprecate`. The bootstrap versions stay visible on npm; npm restricts unpublishing after 72 hours. npm sets `latest` on a package's first publish even with `--tag bootstrap`, so until 0.3.0 is published, `npm i @lazy-ease/core` installs the bootstrap version. The tag workflow publishes 0.3.0 without `--tag`, which moves `latest` to it, so keep the time between the bootstrap publish and the `v0.3.0` tag short.
- **The release itself by hand.** Publish `@lazy-ease/core`, `@lazy-ease/testing`, `@lazy-ease/vanilla` and `@lazy-ease/server` at 0.3.0 by hand from the tarballs `node scripts/pack.mjs` writes, in that order, add their trusted publishers, then tag `v0.3.0`; the workflow skips the four and publishes `@lazy-ease/react`. Those four 0.3.0 versions have no provenance, and since `release.json` describes the tarballs CI packed, their integrity on npm may differ from it (the workflow warns).

### Rollout order for 0.3.0

1. Merge the release preparation to `main` (all packages at 0.3.0, changelog section `## [0.3.0] - date`).
2. Publish the four new packages by hand as chosen above: `@lazy-ease/core` and `@lazy-ease/testing` first, then `@lazy-ease/vanilla` and `@lazy-ease/server`, which depend on core.
3. Add the trusted publisher for each of them, and check the existing one of `@lazy-ease/react`.
4. Run the workflow by hand once (dry run): it should report no missing packages.
5. Tag `v0.3.0` and push the tag. The workflow publishes core, react, server, testing and vanilla in that order (dependencies first) and creates the release with its assets.
6. Check `npm view @lazy-ease/react@0.3.0 dependencies` (it needs `@lazy-ease/core` 0.3.0) and compare `dist.integrity` with `release.json`. A version published by hand from another machine may differ; the Publish step warned about it.
