# Changelog

All notable changes to `@lazy-ease/react` and `@lazy-ease/server` are documented here. Both packages are versioned together.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `@lazy-ease/core` holds the framework-free logic: width and ratio ladders, canonical URL numbers, focal crop geometry, the reference loader and candidate selection. It imports nothing from React or Node, and only the controller uses the DOM. `outputSize()` gives the pixel size the reference backend encodes for a request, apart from the width in the URL.
- `@lazy-ease/testing` publishes portable conformance fixtures as versioned JSON: default ladders, canonical numbers, focal points, crop windows, encoded sizes, candidate lists, source paths and loader URLs, backend admission, and the byte format and test vectors of the optional crop token. The README documents the schema and rules for implementers in other languages. Core and server run the same records in their tests, and `pnpm check:fixtures` recomputes them in Python. Cases that core or the server do not pass yet are tagged by topic: NFC normalization of NFD input in the loader (`nfc`), rejecting a missing `q` (`strict-q`), crop tokens (`token`), and the source path rules for a stray `%`, escapes that are not UTF-8 and schemes other than `http` and `https` (`safe-paths`). Under `safe-paths` a stray `%` no longer double-encodes the rest of its segment (`/é%.jpg` is `/%C3%A9%25.jpg`), a segment that is not UTF-8 keeps its escapes, and a source such as `a:b.jpg` or `x:/hero.jpg` has no URL instead of mapping onto a file under the mount. Core's `encodePath()` follows these rules with step 06. The `url-parsing` topic marks sources that are resolved as URLs (encoded dot segments, backslashes, absolute and protocol-relative URLs, tabs and surrounding spaces); core and the server already pass them. Crop token vectors include requests that spell the signed path non-canonically, since the MAC always covers the canonical path.
- `@lazy-ease/core` has a framework-free DOM controller: `createLazyEase(config).attach(img, options)` returns a handle with `update()` and `destroy()`. It supports prepared candidate lists and URLs, measured images (content-box ResizeObserver, cover width for browser crop, trailing 200 ms growth), native and priority adoption, external/SVG/GIF pass-through, focal positioning, shared IntersectionObservers per root and margin with dwell time, a fade after load and decode with a decode timeout and reduced-motion swap, cached and failed adoption, per-generation cleanup and an element claim shared by every copy of the package. `whenVisible()` is the visibility primitive for decorative backgrounds. `candidateSet()` builds the srcset with encoded-width labels, merged duplicates and a single URL where the fixture rule asks for one, and passes every `candidates.json` record. `isOwned()`, `isDirect()`, `parsePlaceholder()` and `focusStyles()` return framework-neutral values with CSS units. `createLoader({ formats })` declares the formats the backend renders. ThumbHash placeholders decode through the explicit `@lazy-ease/core/thumbhash` entry with an application-supplied `thumbhash` package.
- `@lazy-ease/vanilla` brings lazy-ease to server-rendered HTML without client code of its own. `enhance(le, root)` attaches the controller to every `data-le` image under a document, element or shadow root (the root itself included) and returns a handle whose `destroy()` releases what it attached. It reads prepared lists, single URLs, deferred picture sources, measured and signed sources (`data-le-token`) and native images, and sets `data-le-visible` on decorative `data-le-background` elements once they come near the viewport. Images that another call, instance or bundle already owns are skipped, and so is any subtree whose nearest `data-le-auto` is `"off"`. `lazy-ease.css` (also `cssText` from `@lazy-ease/vanilla/css`, for shadow roots) has zero specificity. `lazy-ease.min.js` starts itself, enhances the `data-le-auto` areas once the document is parsed and leaves no globals; `data-base-url` and `data-formats` on its script tag configure the reference loader for measured images.
- `@lazy-ease/core`: `ImageRequest` and the attach options carry an optional crop `token`, which the reference loader writes between `q` and `v`; core now passes the `token` URL fixture. `imageSet()` builds the CSS `image-set()` value for a decorative background from a loader. `le.config` exposes the config an instance was created with.

### Changed

- `@lazy-ease/react` and `@lazy-ease/server` depend on `@lazy-ease/core`. The React public exports, their signatures and the server-rendered markup are unchanged. `DEFAULT_RATIOS` is static data, so importing core computes nothing; core's own defaults build the same ladder on first use, so `createLoader().ratios` equals `DEFAULT_RATIOS` but is not the same array. The server takes its ladders, number formatting and crop window from core instead of keeping its own copy.
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
