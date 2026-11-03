# Changelog

All notable changes to `lazy-ease` and `@lazy-ease/server` are documented here. Both packages are versioned together.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

#### `lazy-ease`

- The `<noscript>` fallback offers the 1× and 2× candidates when `width` is known instead of the full ladder, and is built once per image.
- Off-screen measured-mode images no longer decode their ThumbHash at hydration; they decode when they near the viewport.
- Once format detection has finished, images set their `srcset` in the same render as their first measurement.
- All images share one `ResizeObserver`; fixed and ratio boxes already at their `width` are not observed.
- `ImageRequest.params` is removed (the component never set it); `createLoader({ params })` stays.
- The public exports are reduced to the component, provider, loader API, ladders, `formatNumber`, `snapRatio`, `fullLadder` and `encodePath`.

#### `@lazy-ease/server`

- `concurrency` defaults to half the CPUs. New `cacheBytes` (64 MB) bounds the in-memory LRU by size, and `avifEffort` (4) sets the AVIF encoder effort.
- The render timeout is sharp's `timeout()` only, and the pixel limit is sharp's `limitInputPixels` only.
- The root's real path is resolved once per app instead of on every request.
- `render` and its option types are exported for build scripts.

## [0.1.0] - 2026-11-03

First release, implementing the [v1 design spec](docs/design-spec.md).

### Added

#### `lazy-ease`

- `<Image>` for React 19 with four layout modes (fill, fixed, ratio, intrinsic) that reserve space before the image loads, and development errors for invalid prop combinations.
- Measured mode (the default): the box is measured when it nears the viewport, and the `srcset` is capped at 2× the measured width and at `srcWidth`. `sizes` only grows on resize, debounced, so upgrades happen only when a ladder step is crossed. In fill mode the crop follows the box ratio.
- Classic mode (`sizes`, `priority`, `loading="native"`): URLs in the server HTML, WebP, visible from the first paint.
- `priority`: eager, `fetchpriority="high"` and a preload link through React's `preload()`, deduplicated with the `<img>`.
- Loading strategies `lazy` (shared `IntersectionObserver`, `scrollMargin` where supported), `native` and `eager`, plus `dwellTime` against fast flings.
- AVIF/WebP detection once per page, started by the provider, with a 200 ms WebP fallback.
- Inline placeholders: CSS colors, data URIs and `thumbhash:` hashes (average color on the server, decoded image after hydration, opt-in server decoding with `thumbhashSsr: 'image'`).
- Crossfade for measured-mode images after `decode()`, raced against a 250 ms timeout; respects `prefers-reduced-motion`. `data-state` on the box.
- `<noscript>` fallback with a full-ladder WebP `srcset`.
- External images: anything that isn't a path or on a configured `domains` host loads as is.
- `<LazyEaseProvider>` with nestable defaults, the `ImageLoader` interface (object or function form), and `createLoader()`, which writes the canonical URL for `@lazy-ease/server`.
- Shared width and ratio ladders (`DEFAULT_WIDTHS`, `DEFAULT_RATIOS`) and the helpers behind them.

#### `@lazy-ease/server`

- `createImageApp({ root })`: a Hono app for `GET`/`HEAD /{src path}?ar&fmt&q&v&w` that accepts only canonical query strings and ladder values.
- Path safety: realpath containment (symlinks included), NFC normalization, and rejection of backslashes, drive letters, UNC prefixes, dot segments, null bytes and unsupported extensions.
- sharp pipeline: EXIF auto-orient, center crop, sRGB, metadata stripped, no upscaling, first GIF frame.
- Limits: 50 MP input, 32 MB file size checked before decoding, 10 s render timeout, a render concurrency cap with coalescing of identical requests, and an in-memory LRU.
- Caching headers (`immutable`, `ETag` with `304`, `nosniff`).
- `computeMetadata()` for upload or build scripts (oriented size, ThumbHash, dominant color) and `createMetaApp()` for local tooling.

### Fixed

- Measured mode now sets `sizes` before `srcset`. WebKit selects a candidate as soon as `srcset` is set, so it used to fetch the `100vw` candidate first and then the right one.

[Unreleased]: https://github.com/mikekuss/lazy-ease/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mikekuss/lazy-ease/releases/tag/v0.1.0
