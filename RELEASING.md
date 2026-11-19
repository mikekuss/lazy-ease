# Releasing

All five packages are released together at one version: `@lazy-ease/core`, `@lazy-ease/react`, `@lazy-ease/server`, `@lazy-ease/testing` and `@lazy-ease/vanilla`. Each `@lazy-ease` dependency is `workspace:*` in the repository, and pnpm packs it as the exact version of the same release, so the packages on npm always match each other.

Pushing a version tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml). It checks that the tag, the package versions and the changelog agree (`scripts/release-check.mjs`), runs typecheck, tests and build, packs every package with pnpm and checks the tarballs, compares them with any version already on npm, publishes them to npm with provenance, dependencies first, and creates the GitHub Release from `CHANGELOG.md` with the release assets.

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

`pnpm test:frames` starts the demo dev servers (Vite on 5173, the image server on 3001; `PORT` and `SERVER_PORT` move them), or reuses them if `pnpm dev` is already running in the same checkout (it refuses servers that another worktree started on those ports), opens `apps/demo/controller.html` in Chromium and checks that every controller case passes. Then it reruns the fade, placeholder, lazy scroll-root, priority, resize, failed-upgrade and `update()` cases while recording the real screen frames, and fails if any frame shows alt text, a broken-image icon or a blank box between the placeholder and the image. A failing test attaches a contact sheet of the frames to the report (`apps/e2e/playwright-report/frames`, open it with `pnpm --filter e2e exec playwright show-report playwright-report/frames`). How frames are judged is described at the top of `apps/e2e/frames/controller-frames.spec.ts`.

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

The run fails before anything is published if the tag isn't `v` plus the shared version, if the changelog has no `## [x.y.z]` section, if a packed `package.json` still has a `source` export condition or needs a `@lazy-ease` package at another version, if one of the packages doesn't exist on npm yet (see [First publish of a new package](#first-publish-of-a-new-package)), or if a version that is already on npm has other files than the tarball packed in the run.

The packages are published one by one in dependency order: `@lazy-ease/core`, then the packages that need it. If a run stops halfway, npm holds the dependencies but not yet the packages that need them, never the other way round. Re-running a failed run is safe: a version that is already on npm is downloaded and compared file by file with the tarball packed in the run, skipped if they match and a failure if they don't, and an existing GitHub Release for the tag only gets the assets it lacks (an asset that differs from the run fails it). Re-running only the GitHub Release job works while the `release-assets` artifact is kept (7 days); after that, re-run the whole workflow. To change the code of a release, bump the version instead; npm doesn't allow publishing a version twice.

A version with a pre-release part (`1.0.0-rc.1`) is published under the npm dist-tag `next` and marked as a pre-release on GitHub.

To try the workflow without publishing, run it from the Actions tab (Release → Run workflow). That is a dry run: it accepts a changelog that still says `## [Unreleased]`, runs `pnpm publish --dry-run` (skipped if the version is already on npm), warns about packages that aren't on npm yet and creates no release. The release assets (`release-assets`) and the tarballs (`tarballs`) are kept as workflow artifacts for 7 days.

## Release assets

The GitHub Release for each tag carries:

- the conformance fixtures of `@lazy-ease/testing`: `manifest.json` and every file it lists, byte for byte from the packed tarball (`scripts/fixture-assets.mjs`). Check them against the lengths and SHA-256 sums in `manifest.json` after downloading.
- `release.json`: the version, the commit, and per package the tarball name, size, npm `integrity` (`sha512-…`) and `shasum`, its `@lazy-ease` dependencies and every file with its size and SHA-256. `npm view @lazy-ease/core@x.y.z dist.integrity` prints the same integrity for a version the workflow published.

For a version that was already on npm with the same files, for example one published by hand, `release.json` has npm's size, integrity and shasum: the same files can be a different gzip on another machine.

## One-time setup on npmjs.com

The workflow uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers): npm accepts an OIDC token from this workflow, so there is no `NPM_TOKEN` secret. It needs npm 11.5.1 or later, which the workflow installs, and a GitHub-hosted runner. Each package needs a trusted publisher, and npm can only add one to a package that already exists:

1. On npmjs.com, open the package → Settings → Trusted Publisher → GitHub Actions.
2. Enter organization or user `mikekuss`, repository `lazy-ease`, workflow filename `release.yml`. Leave the environment empty. The fields are case-sensitive, and npm checks them only when publishing.
3. Under allowed actions, allow `npm publish`. Trusted publishers created after 2026-09-03 start with staged publishing only, and this workflow publishes directly.
4. After the first release from the workflow, consider setting Publishing access to "Require two-factor authentication and disallow tokens". Trusted Publishing keeps working.

An `ENEEDAUTH` error in the Publish step means the trusted publisher doesn't match the repository, workflow filename or allowed actions.

`repository.url` in each `package.json` must stay `git+https://github.com/mikekuss/lazy-ease.git`; npm compares it with the repository the token comes from, and `pnpm check:release` checks it.

### First publish of a new package

Up to 0.2 only `@lazy-ease/react` was on npm. `@lazy-ease/core`, `@lazy-ease/testing`, `@lazy-ease/vanilla` and `@lazy-ease/server` don't exist there yet, so they can't have a trusted publisher, and a tag push fails at "Compare with npm" before anything is uploaded. Each new package needs one version published by hand first, from a tarball pnpm packed (only pnpm applies `publishConfig.exports` and replaces `workspace:*`), logged in to npm as the owner of the `@lazy-ease` scope with two-factor authentication.

For 0.3.0 the four are published by hand at 0.3.0 itself, from the tarballs a dry run of the workflow packed, so npm gets the exact bytes CI checked:

1. On the commit you will tag, run the workflow by hand (Release → Run workflow). It warns that the four packages are missing.
2. Download its tarballs: `gh run download <run-id> --name tarballs --dir .cache/tarballs`.
3. Logged in to npm as the owner of the `@lazy-ease` scope, publish them in dependency order: `npm publish .cache/tarballs/lazy-ease-core-0.3.0.tgz --access public`, then `testing`, `vanilla` and `server` the same way. npm asks for a two-factor code for each.

These four 0.3.0 versions have no provenance; later versions from the workflow have it. When the tag runs, the workflow compares each of them file by file with the tarball it packs, skips them and publishes `@lazy-ease/react`.

A bootstrap pre-release (for example `0.3.0-bootstrap.0` under the dist-tag `bootstrap`) would give 0.3.0 provenance, but it stays visible on npm, and npm sets `latest` on a package's first publish even with `--tag`, so `npm i @lazy-ease/core` would install it until 0.3.0 is out.

### Rollout order for 0.3.0

1. Merge the release preparation to `main` (all packages at 0.3.0, changelog section `## [0.3.0] - date`) and run the local checks on it.
2. Publish `@lazy-ease/core`, `@lazy-ease/testing`, `@lazy-ease/vanilla` and `@lazy-ease/server` by hand from a dry run's tarballs, as above.
3. Add the trusted publisher for each of them, and check the existing one of `@lazy-ease/react`.
4. Run the workflow by hand again (dry run): it should report the four as on npm and identical, and no missing packages.
5. Tag `v0.3.0` and push the tag. The workflow skips the four, publishes `@lazy-ease/react` and creates the release with its assets.
6. Check `npm view @lazy-ease/react@0.3.0 dependencies` (it needs `@lazy-ease/core` 0.3.0) and compare each `dist.integrity` with `release.json`.
