# Changelog

All notable changes to `@lazy-ease/react` and `@lazy-ease/server` are documented here. Both packages are versioned together.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The READMEs no longer link to `@lazy-ease/server` on npm, where it isn't published yet. They point to the repository instead.
- `@lazy-ease/react` is published from GitHub Actions with npm Trusted Publishing, so new versions carry a provenance attestation.

## [0.2.0] - 2026-11-06

### Added

#### `@lazy-ease/react`

- `focalPoint={{ x, y }}` (percent of the source, 0–100, rounded to whole percent) keeps a point in view when the image is cropped. The point ends up as close to the box center as the image edges allow, the semantics of imgix's `fp-x`/`fp-y` and Cloudflare's `gravity`. The center is the default and is never sent.
- `ImageRequest.focalPoint`, set when the request has a crop ratio, and `fx`/`fy` in the URLs `createLoader()` writes. A new focal point is a new URL and loads a new variant. The `FocalPoint` type is exported.
- With a focal point, the box is a size container and the `<img>` gets an `object-position` in container units, so images the server doesn't crop (classic fill without `aspectRatio`, external images) are placed right in the server HTML and on every resize. Uncropped images need `srcWidth` and `srcHeight` for this; without them they fall back to `object-position: x% y%` with a development warning. Image placeholders move to a layer inside the box and are placed the same way.
- README sections on the focal point and on the Next.js App Router (provider and loaders in a client file).

#### `@lazy-ease/server`

- `fx` and `fy` crop around the focal point: whole numbers 0–100, both or neither, only with `ar`, never both `50`. The window is cut from the oriented source before scaling and is part of the render key and the `ETag`. The `FocalPoint` type is exported.

## [0.1.0] - 2026-11-04

First release, implementing the [v1 design spec](docs/design-spec.md).

### Added

#### `@lazy-ease/react`

- `<Image>` for React 19 with four layout modes (fill, fixed, ratio, intrinsic) that reserve space before the image loads, and development errors for invalid prop combinations.
- Measured mode (the default): the box is measured when it nears the viewport, and the `srcset` is capped at 2× the measured width and at `srcWidth`. `sizes` only grows on resize, debounced, so upgrades happen only when a ladder step is crossed. In fill mode the crop follows the box ratio. All images share one `ResizeObserver`; fixed and ratio boxes already at their `width` are not observed. Once format detection has finished, an image sets its `srcset` in the same render as its first measurement.
- Classic mode (`sizes`, `priority`, `loading="native"`): URLs in the server HTML, WebP, visible from the first paint.
- `priority`: eager, `fetchpriority="high"` and a preload link through React's `preload()`, deduplicated with the `<img>`.
- Loading strategies `lazy` (shared `IntersectionObserver`, `scrollMargin` where supported), `native` and `eager`, plus `dwellTime` against fast flings.
- AVIF/WebP detection once per page, started by the provider, with a 200 ms WebP fallback.
- Inline placeholders: CSS colors, data URIs and `thumbhash:` hashes (average color on the server, decoded image after hydration, opt-in server decoding with `thumbhashSsr: 'image'`). Off-screen measured-mode images decode their ThumbHash when they near the viewport, not at hydration.
- Crossfade for measured-mode images after `decode()`, raced against a 250 ms timeout; respects `prefers-reduced-motion`. `data-state` on the box.
- `<noscript>` fallback, built once per image, with a WebP `srcset` of the 1× and 2× candidates when `width` is known and the full ladder otherwise.
- External images: anything that isn't a path or on a configured `domains` host loads as is.
- `<LazyEaseProvider>` with nestable defaults, the `ImageLoader` interface (object or function form), and `createLoader()`, which writes the canonical URL for `@lazy-ease/server`.
- `<Image>` and `<LazyEaseProvider>` are client modules (`'use client'`), so React Server Components can render them.
- Public exports: `<Image>`, the provider, the loader API, the shared width and ratio ladders (`DEFAULT_WIDTHS`, `DEFAULT_RATIOS`), `formatNumber`, `snapRatio`, `fullLadder` and `encodePath`.

#### `@lazy-ease/server`

- `createImageApp({ root })`: a Hono app for `GET`/`HEAD /{src path}?ar&fmt&q&v&w` that accepts only canonical query strings and ladder values.
- Path safety: realpath containment (symlinks included), NFC normalization, and rejection of backslashes, drive letters, UNC prefixes, dot segments, null bytes and unsupported extensions. The root's real path is resolved once per app.
- sharp pipeline: EXIF auto-orient, center crop, sRGB, metadata stripped, no upscaling, first GIF frame.
- Limits: 50 MP input (sharp's `limitInputPixels`), 32 MB file size checked before decoding, 10 s render timeout, a render concurrency cap (`concurrency`, default half the CPUs) with coalescing of identical requests, and an in-memory LRU bounded by size (`cacheBytes`, default 64 MB). `avifEffort` (default 4) sets the AVIF encoder effort.
- Caching headers (`immutable`, `ETag` with `304`, `nosniff`).
- `computeMetadata()` for upload or build scripts (oriented size, ThumbHash, dominant color), `render()` and its option types for build scripts, and `createMetaApp()` for local tooling.

### Fixed

- Measured mode now sets `sizes` before `srcset`. WebKit selects a candidate as soon as `srcset` is set, so it used to fetch the `100vw` candidate first and then the right one.

[Unreleased]: https://github.com/mikekuss/lazy-ease/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/mikekuss/lazy-ease/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/mikekuss/lazy-ease/releases/tag/v0.1.0
