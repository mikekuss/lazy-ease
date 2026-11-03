# lazy-ease design spec (v1)

Status: reviewed draft. Incorporates the architecture review of 2026-11-03 and the performance and simplicity review of the same day. Supersedes the behavior of the current scaffold where they differ. Sections 16 and 17 list what the reviews changed.

## 1. Goals

1. **Less data over the network.** Every image is delivered at the size it is rendered at (× device pixel ratio, capped at 2), cropped on the server and in a modern format.
2. **Correct display.** No layout shift. Fixed sizes, aspect ratios and fill boxes render exactly as declared, including after resize or rotation.
3. **No unnecessary loads.** Off-screen images are not requested until they approach the viewport. In measured mode (the default), images that are hidden (`display: none`) are never requested.
4. **Immediate placeholder.** A placeholder is inline in the server HTML and visible on first paint, with no request.
5. **Ratios and fixed widths.** Both are first-class.

## 2. Non-goals for v1

- Art direction (different crops per media query). Planned for v2 together with focus points.
- Focus-point cropping. v2.
- Resizing images we do not host (external images).
- `overrideSrc`, `getImageProps()`, format configuration, a global loader file, fixed source lists.
- Backends other than the Node reference server. The AWS reference deployment (CloudFront → regional Lambda with sharp → S3 cache) is v1.1, Cloudflare later.
- Aborting downloads that are already running. Browsers do not cancel them reliably.
- Format negotiation through the `Accept` header (`fmt=auto`, `Vary: Accept`). CloudFront and Cloudflare do not key their caches on `Accept` by default, so this risks serving AVIF to a browser that cannot decode it. Formats are always explicit in the URL.
- A public metadata endpoint. Metadata is computed by tooling at upload or build time (12.3).
- SVG, TIFF and animated images as backend sources. SVG is served as is (treated as external).

## 3. Terms

| Term | Meaning |
| --- | --- |
| **Owned image** | Served by a lazy-ease-compatible backend: a relative path or a URL on a configured domain. Fully optimized. See 10. |
| **External image** | Any other URL, or any image with `unoptimized`. Loaded as is. |
| **Width ladder** | The fixed list of widths the backend renders: `[64, 128, 256, 384, 640, 750, 828, 1080, 1200, 1440, 1920, 2560, 3840]`. Part of the loader; backend and loader must agree. |
| **Ratio ladder** | The fixed list of crop ratios the backend renders (6.1). Part of the loader; backend and loader must agree. |
| **Box** | The wrapper element the component renders. Its size is what gets measured. |
| **Loader** | Turns an image request into a URL and declares the backend's capabilities. The only coupling between component and backend. |
| **Measured mode** | The default. URLs are built on the client after the box has been measured (6.2). |
| **Classic mode** | URLs are in the server HTML: `sizes` set, `priority`, or `loading="native"` (6.3). |

## 4. Packages

| Package | Role |
| --- | --- |
| `lazy-ease` | React 19 component, provider, loader interface, default loader for the reference backend. No runtime dependencies besides React; the ThumbHash decoder is tree-shaken when unused. |
| `@lazy-ease/server` | Node reference backend (Hono + sharp) and metadata tooling for upload or build scripts. |
| `apps/demo` | Demo with network throttling. Not published. |

## 5. Component API

```tsx
<Image src="/photos/lake.jpg" alt="…" width={320} height={240} />
<Image src="/photos/lake.jpg" alt="…" aspectRatio={16 / 9} placeholder="#5b6c8f" />
<Image src="/photos/lake.jpg" alt="…" fill placeholder={`thumbhash:${hash}`} />
<Image src="https://other.site/a.jpg" alt="…" width={400} height={300} />   // external
<Image src="/hero.jpg" alt="…" fill aspectRatio={2} sizes="100vw" priority />
```

### 5.1 Props

| Prop | Type | Default | Behavior |
| --- | --- | --- | --- |
| `src` | `string` | required | Path or URL of the source image. Changing it resets the state to `idle` and shows the placeholder again. |
| `alt` | `string` | required | Passed to `<img>`. |
| `width` | `number` | | Rendered width in CSS px. |
| `height` | `number` | | Rendered height in CSS px. Only valid together with `width` (fixed mode). |
| `aspectRatio` | `number` | | Box ratio in ratio mode. In fill mode: the crop ratio sent to the backend instead of the measured one (5.2). |
| `fill` | `boolean` | `false` | The box fills its positioned parent. |
| `sizes` | `string` | measured | Classic `sizes`. When set, measuring is not used for width selection and the full ladder is offered (6.3). Wins over `width` for candidate selection. |
| `srcWidth`, `srcHeight` | `number` | | Intrinsic size of the source, from `computeMetadata`. Ladder widths above `srcWidth` are not offered (6.2). Optional but recommended. |
| `version` | `string` | | Opaque cache-busting token (content hash or mtime) passed to the loader as `version` (6.1). |
| `quality` | `number` | loader | Snapped to the nearest quality the loader allows. |
| `loading` | `'lazy' \| 'native' \| 'eager'` | `'lazy'` | See 7.1. `native` requires `sizes` or `width`. |
| `rootMargin` | `string` | provider (`'400px'`) | Preload distance for `lazy`. |
| `priority` | `boolean` | `false` | Eager, `fetchpriority="high"` and a preload link. Requires `width` or `sizes`; otherwise a thrown error in development. Use it for the LCP image only. |
| `placeholder` | `string` | provider (neutral color) | A CSS color, a data URI, `thumbhash:<base64>` or `'none'`. See 8. |
| `fadeDuration` | `number` | provider (`400`) | Crossfade in ms for measured-mode images. `0` swaps instantly after decode. Classic-mode images never fade (9). |
| `unoptimized` | `boolean` | auto | Forces external-image behavior. A `loader` prop on an unoptimized image is ignored with a dev warning. |
| `loader` | `ImageLoader` | provider | Per-image loader override. |
| `onLoad`, `onError` | | | Passed through. `onLoad` fires once, for the first displayed image. Later srcset upgrades are not surfaced. |
| `ref` | | | Forwarded to the `<img>`. |
| `className`, `style` | | | Applied to `<img>`. |
| `wrapperClassName`, `wrapperStyle` | | | Applied to the box. |

Any other `<img>` attribute (`crossOrigin`, `referrerPolicy`, `decoding`, …) is passed through. `decoding` defaults to `"async"`.

### 5.2 Layout modes

The mode is derived from the props with this precedence. Props the selected mode does not use trigger a development error.

| Precedence | Mode | Trigger | Box CSS | Crop ratio sent to backend |
| --- | --- | --- | --- | --- |
| 1 | **fill** | `fill` | `position: absolute; inset: 0` | `aspectRatio` if given, otherwise the measured box ratio snapped to the ratio ladder. In classic mode without `aspectRatio`: none (no crop; `object-fit` crops). |
| 2 | **fixed** | `width` and `height` | `width: {w}px; max-width: 100%; aspect-ratio: {w} / {h}` (no explicit height) | `w / h` snapped to the ratio ladder |
| 3 | **ratio** | `aspectRatio` (with or without `width`) | `width: {w}px or 100%; aspect-ratio: {r}` | `r` snapped to the ratio ladder |
| 4 | **intrinsic** | only `width`, or nothing | `width: {w}px or 100%`, height from the image | none (no crop) |

Invalid combinations: `height` without `width`; `fill` with `width` or `height`; `width`, `height` and `aspectRatio` together; `priority` or `loading="native"` without `width` or `sizes`.

The `<img>` is `width: 100%; height: 100%; object-fit: cover` in fill, fixed and ratio modes and carries `width`/`height` attributes when known. `fill` requires a positioned parent; the component does not add one.

`intrinsic` cannot reserve height, so it causes layout shift. The component logs a development warning suggesting `height`, `aspectRatio` or `fill`.

### 5.3 Provider

`<LazyEaseProvider>` sets defaults for a subtree. Nested providers merge.

| Option | Default |
| --- | --- |
| `loader` | `createLoader({ baseUrl: '/_img' })` (carries the width ladder, the ratio ladder, qualities and formats) |
| `domains` | `[]`, extra hosts treated as owned besides relative paths (10) |
| `quality` | `75` |
| `loading` | `'lazy'` |
| `rootMargin` | `'400px'` |
| `dwellTime` | `0` ms (see 7.2) |
| `placeholder` | a neutral color, e.g. `'#e5e7eb'` |
| `fadeDuration` | `400` |
| `thumbhashSsr` | `'color'`: the server renders only the average color; `'image'` renders the decoded image (8) |

Mounting a provider starts format detection (6.4).

## 6. Width and format selection (owned images)

### 6.1 URL contract

```ts
interface ImageRequest {
  src: string
  width: number            // always a value of the loader's width ladder
  aspectRatio?: number     // always a value of the ratio ladder; absent when there is no crop
  quality: number          // always a value of the loader's qualities
  format: 'avif' | 'webp' | 'jpeg' | 'auto'   // 'auto' only for loaders that declare formats: 'auto'
  version?: string         // the `version` prop, opaque
}

interface ImageLoader {
  url(request: ImageRequest): string
  widths: readonly number[]                        // the width ladder
  ratios?: readonly number[]                       // the ratio ladder; default: the one below
  qualities: readonly number[]
  formats: readonly ('avif' | 'webp' | 'jpeg')[] | 'auto'
}
```

A plain function `(request) => string` is accepted as shorthand and gets the default ladders, `qualities: [75]` and `formats: ['avif', 'webp', 'jpeg']`. The `loader` prop and provider option accept both forms.

**Ratio ladder.** `2^(k/16)` for `k = -32 … 32` (65 values from 0.25 to 4, 4.4 % apart; `0.5`, `1` and `2` are on it), plus `4/3, 3/2, 16/9, 21/9` and their inverses (73 values in total). Every mode snaps its crop ratio to the nearest ladder value (maximum error 2.2 %, hidden by `object-fit: cover`), so a 4:3 box is one variant whether it came from `width`/`height`, `aspectRatio` or a fill measurement. Ratios outside 0.25–4 are clamped; the browser crops the rest. Values are rounded to 3 decimals with `Number(x.toFixed(3))` on both sides.

**Bound.** Cache variants per source are at most `widths × ratios × qualities × formats` = 13 × 73 × 1 × 3. In practice a source is rendered at a handful of ratios.

**Canonical URL.** The default loader emits `{baseUrl}/{src path}?ar={ar}&fmt={fmt}&q={q}&v={version}&w={w}`:

- Parameters in alphabetical order, names and values lowercase, absent parameters omitted (`ar` when there is no crop, `v` when there is no version).
- Numbers without trailing zeros or exponent (`1.5`, not `1.50`), at most 3 decimals.
- The source path is the URL path, each segment `encodeURIComponent`-encoded, so the URL ends in the source's extension. This matters for CDNs that cache by extension (12.4).

Order and case matter for CDN cache keys ([CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/QueryStringParameters.html)), and the backend rejects non-canonical strings (12.1), so no two URLs for the same variant can exist.

Third-party loaders map the request to their own syntax. Known mappings: imgix `w`, `ar={ar}:1`, `fit=crop`, `fm`, `q`; Cloudinary `w_`, `ar_`, `c_fill`, `f_`, `q_`; Cloudflare Images `width`, `height=round(w/ar)`, `fit=cover`, `format`, `quality` (it has no ratio parameter). All three negotiate the format through `Accept`, so their loaders declare `formats: 'auto'` and the component skips detection.

### 6.2 Measured mode (default when `sizes` is not set)

1. Before the image is near the viewport, no `src`/`srcset` is set.
2. When the box enters the preload zone (and has been there for `dwellTime`), the component measures the box width in CSS px.
3. It sets `srcset` to the **capped ladder** (with the crop ratio) and `sizes` to the measured width, e.g. `sizes="412px"`. The browser picks the candidate for its device pixel ratio. The cap: no candidate above `snap(2 × measured width)` (a DPR-3 device gets the 2× candidate, since browsers take the largest available when none reaches the DPR), and none above `srcWidth` when given (the backend never upscales, so those would be identical bytes under different URLs).
4. One `ResizeObserver`, shared by all images, keeps `sizes` current from the box's content rect. A fixed or ratio box whose first measurement already equals its `width` is not observed: it cannot grow, and `sizes` never shrinks. `sizes` is **monotonic**: it is only raised, never lowered, so no engine ever considers a downgrade. It is written only when the snapped candidate for `measured width × DPR` changes, after a trailing debounce of 200 ms (a window drag fires every frame; a rotation is one change). When the box grows past a ladder step, the browser loads the larger candidate and keeps showing the old one until it is ready. The cap moves with the width.
5. In fill mode without `aspectRatio`, if the snapped box ratio moves to another ladder value, the `srcset` is rebuilt with the new ratio.

Changing the `sizes` attribute is a relevant mutation that re-runs selection in every engine; viewport resizes alone are not (WebKit never re-selects on resize, [bug 149899](https://bugs.webkit.org/show_bug.cgi?id=149899)). Measured mode only relies on the attribute path.

The measured srcset exists only in the client DOM. The server HTML carries only the `<noscript>` fallback (7.3), which has two candidates when `width` is known, so it stays small.

**Cost.** Every measured-mode image waits for hydration, intersection and measurement; the preload scanner never sees it. Images that are likely in the first viewport should use classic mode (`sizes` or `priority`). In development the component warns when a measured-mode image is already intersecting the viewport when it hydrates.

### 6.3 Classic mode (`sizes` set, or `priority`, or `loading="native"`)

These need URLs in the server HTML, before JavaScript runs, so nothing can be measured.

- With `sizes`: the full ladder (capped at `srcWidth` when given) plus the given `sizes`. `sizes` wins over `width`.
- **fixed** or **ratio** with `width` and no `sizes`: candidates `snap(w)` and `snap(2w)` (deduplicated, capped at `srcWidth` and at the largest ladder width), with `sizes="{w}px"`.
- **fill** in classic mode: the crop ratio is `aspectRatio` when given, otherwise there is no server crop and `object-fit` crops.
- `loading="native"` requires `sizes` or `width` (dev error otherwise). `sizes="auto"` is not used: it is Chromium 126+ only, and Safari falls back to `100vw`, which over-fetches ([caniuse](https://caniuse.com/wf-sizes-auto)).

### 6.4 Format

- **Client-rendered images** (measured mode): the component detects AVIF and WebP support once per page by decoding tiny embedded test images. Detection starts when the provider mounts (or on first import without a provider), so it normally finishes before the first image intersects. Images wait for it, with a 200 ms timeout after which WebP is used. The result is cached in memory; once it is known, an image reads it synchronously and sets its format in the same render as its first measurement, with no wait. URLs carry the format explicitly (AVIF, then WebP, then JPEG). Loaders with `formats: 'auto'` skip detection and receive `format: 'auto'`.
- **Server-rendered images** (classic mode): the format can't be detected before JavaScript runs. They use WebP, which every target browser supports. No `<picture>`: a preload link per format would make AVIF-capable browsers fetch the LCP image twice, and AVIF is the slowest format to encode. No `Accept` negotiation (2).

Support reference: AVIF in Safari 16.4+, Chromium 85+, Firefox 93+ ([caniuse](https://caniuse.com/avif)).

## 7. Loading

### 7.1 Strategies

| `loading` | Behavior |
| --- | --- |
| `lazy` (default) | A shared `IntersectionObserver` per `rootMargin`. Starts the load when the box comes within `rootMargin` of the viewport. Hidden boxes never intersect and are never loaded. |
| `native` | URLs are in the HTML with `loading="lazy"`. The browser decides when to load (Chrome: about 1250 px on fast connections, 2500 px on slow ones, hardcoded and subject to change). Classic mode only; requires `sizes` or `width`. A hidden image is still fetched by the browser. |
| `eager` | Loads right away. |

`rootMargin` has no effect along the scroll axis inside a nested scroll container (carousels, `overflow: auto` panels): the container clips before the margin applies. Where `IntersectionObserver` supports `scrollMargin` (Chromium 120+), the component passes the same value; elsewhere such images load when they become visible. Documented as a known limitation.

`priority` implies `eager`, `fetchpriority="high"` (Safari 17.2+, Firefox 132+, ignored elsewhere), and a `<link rel="preload" as="image" imagesrcset imagesizes fetchpriority="high">` emitted through React 19's `preload()` from `react-dom`. React dedupes preloads only on identical `href`, `imageSrcSet` and `imageSizes`, so the link and the `<img>` use the same string builder; `href` is the middle candidate. Use `priority` for the LCP image only.

### 7.2 Dwell time

With `dwellTime > 0`, a box must stay in the preload zone for that long before its load starts. If it leaves earlier, nothing is requested. This handles fast flings through long galleries. The default is `0`.

### 7.3 No-JS

Lazy images render a `<noscript>` with a plain `<img loading="lazy">` carrying the `srcset` and `sizes` the classic mode would emit without `sizes` (6.3): `snap(w)` and `snap(2w)` with `sizes="{w}px"` when `width` is known, otherwise the full ladder with `sizes="100vw"`; crop ratio, WebP and `alt` as usual, so no-JS users get a correctly sized image. It is built once per image (memoized), not on every render. React does not hydrate `<noscript>` children; the SSR test checks the markup is emitted unescaped.

## 8. Placeholder

Rendered as an inline style on the box, so it is in the server HTML and painted on first frame with no request.

| Input | Detected by | Rendered as |
| --- | --- | --- |
| CSS color (`#rgb`, `#rrggbb`, `rgb()`, `hsl()`, named) | anything not matched below | `background-color` |
| Data URI | `data:` prefix | `background-image: url(…)`, `background-size: cover` |
| ThumbHash | `thumbhash:` prefix, then base64 | see below |
| `'none'` | | nothing |

The default, when no prop is given, is the provider's neutral color. This applies to external images too.

**ThumbHash.** The decoder's PNG data URI is uncompressed: up to 32×32 RGBA, about 5.5 KB of base64 per image that gzips poorly. So:

- On the server (and during hydration) the component renders only the hash's average color (`thumbHashToAverageRGBA`, no decode) as `background-color`. Goal 4 holds: color on first paint, no request.
- On the client, for images not yet `loaded`, it decodes the hash to a PNG data URI (memoized per hash) and sets `background-image`. Measured-mode images decode when their load is triggered (they enter the preload zone, or on mount with `eager`), so off-screen images never decode; classic-mode images decode right after hydration.
- `thumbhashSsr: 'image'` on the provider, or `priority` on the image, renders the decoded image on the server instead. Intended for the hero only.

The decoder is bundled and tree-shaken when unused.

The background is removed once the image is `loaded` (after the fade, if any), so transparent images don't show it.

**CSP.** Inline styles need `style-src-attr 'unsafe-inline'` (or an equivalent hash/nonce setup), data URIs need `img-src data:`. Documented in the README.

## 9. Fade

Only measured-mode images fade. Rule: **an image that has started painting is never hidden.** Classic-mode images (`priority`, `sizes`, `native`) render at `opacity: 1` from the server with the placeholder behind them, paint as the browser paints them, and are not gated on `decode()`. Chrome excludes `opacity: 0` paints from LCP, so a fading hero would register LCP only after hydration ([LCP spec](https://www.w3.org/TR/largest-contentful-paint/)).

For measured-mode images:

1. The `<img>` gets `opacity: 0` on the client, at the moment the component sets `srcset`.
2. On `load`, the component awaits `Promise.race([img.decode().catch(() => {}), timeout(250)])` and then sets `opacity: 1` with a CSS transition of `fadeDuration`. A partially downloaded image is never visible. The timeout and the catch cover engines where `decode()` never settles or does not reject on a source change (WebKit [216478](https://bugs.webkit.org/show_bug.cgi?id=216478), [279623](https://bugs.webkit.org/show_bug.cgi?id=279623)). A decode result whose `currentSrc` no longer matches is ignored.
3. If the image is already complete when React attaches (cache), the same path runs from a ref callback. `complete` with `naturalWidth === 0` is an error, not a load.
4. Later srcset upgrades (6.2 step 4) don't fade again. The browser swaps the pixels in place.
5. `fadeDuration: 0`, or `prefers-reduced-motion: reduce`, swaps instantly after decode.
6. On error, the placeholder stays and the box gets `data-state="error"`.

The box exposes `data-state="idle" | "loading" | "loaded" | "error"` for styling and tests.

## 10. External images

An image is **owned** when its `src` parses (against a dummy base) to a path-only URL, or to an absolute URL whose hostname is in `domains` (case-insensitive, exact match, port must match if given). Protocol-relative (`//host/x`), `data:` and `blob:` URLs are external. A query or hash on an owned `src` keeps it owned. Everything else, and every image with `unoptimized`, is **external**:

- `src` is used as is. There is no `srcset` and no resizing.
- Layout modes, lazy loading, the placeholder (default: the neutral color) and the fade work the same way.
- Cropping in fixed, ratio and fill modes happens only through `object-fit: cover`.

**`domains` and the default loader.** The reference backend only serves paths inside its root (12.1). The default loader therefore strips the origin from an owned absolute URL and sends the path: `domains` means "these hosts serve the same files as my root". Third-party loaders receive the absolute URL unchanged. A loader that cannot handle an absolute `src` throws a development error.

## 11. SSR and hydration

- Every mode renders deterministic HTML on the server: box with layout CSS and placeholder, `<img>` with `alt` and dimensions, no `src` for lazy images, plus `<noscript>`.
- Classic-mode images (priority, `sizes`, native) carry `src` and `srcset` in the HTML and are visible (`opacity: 1`) from the first paint (9).
- Nothing reads `window` or the DOM during render. Format detection, ThumbHash image decoding and measuring happen in effects.
- A measured-mode image already intersecting at hydration triggers the development warning from 6.2.

## 12. Backend contract (`@lazy-ease/server`)

### 12.1 `GET /{src}`

The image app is mounted at the loader's `baseUrl` (default `/_img`). The source path is the URL path after the mount point, matching the default loader's `{baseUrl}/{src path}?…` (6.1); the parameters are the query string.

| Param | Required | Rule |
| --- | --- | --- |
| path | yes | Path inside the configured root. Resolved with `realpath` and checked against the root's real path (symlinks included), which is resolved once per app. Rejected: absolute URLs, `..` after normalization, null bytes, backslashes and drive letters, UNC prefixes, extensions outside `jpg jpeg png webp avif gif`. Unicode is NFC-normalized before lookup. |
| `w` | yes | Must be a width-ladder value, otherwise 400. |
| `ar` | no | Must be a ratio-ladder value in canonical form, otherwise 400. With it the output is `w × round(w / ar)`, cropped with `cover` around the center. Without it, the width is scaled with the ratio kept. |
| `q` | no | Must be an allowed quality (default `[75]`), otherwise 400. |
| `fmt` | yes | `avif`, `webp` or `jpeg`. |
| `v` | no | Opaque, at most 64 URL-safe characters. Ignored by the renderer; it exists for the cache key. |

- **Canonical only.** Parameters must appear in alphabetical order, once each, lowercase, with numbers in canonical form (`1.5` not `1.50`, `640` not `0640`). Anything else is 400. Unknown parameters are 400. This keeps one URL per variant on CDNs that key on the raw query string.
- **Never upscaled.** If the source is smaller than the target, the output shrinks and the ratio is kept.
- **Pipeline.** Auto-orient from EXIF before cropping, convert to sRGB, strip all metadata (EXIF, GPS, XMP) from the output. GIF: first frame only.
- **Limits.** `limitInputPixels` 50 MP (sharp rejects the source before decoding its pixels), input file size cap (default 32 MB, checked with `stat` before decoding), `failOn: 'warning'`, a per-render timeout (default 10 s), a concurrency cap on renders with coalescing (one render per cache key in flight; concurrent requests wait for it). After `timeout` ms the request is answered with 504. sharp also receives the timeout (whole seconds, rounded up) to stop decode and resize work, but an AVIF encode already running finishes in the background, so `avifEffort` (default 4) bounds that part.
- **Memory.** `concurrency` defaults to half the CPUs (at least 1), since libvips runs several threads per render. Each running render holds the input buffer (up to `maxFileSize`) and the decoded raster (up to `maxInputPixels` × 4 bytes, 200 MB at the defaults), so peak render memory is about `concurrency × (maxFileSize + 4 × maxInputPixels)`.
- **Headers.** `Cache-Control: public, max-age=31536000, immutable`, `Content-Type`, `Content-Length`, `ETag` (hash of the cache key plus source mtime) with `304` support, `X-Content-Type-Options: nosniff`. `HEAD` is supported.
- **Errors.** 400 for invalid parameters, 404 for a missing or forbidden source, 413 for a source over the limits, 504 on timeout.
- The Node server keeps a small in-memory LRU of encoded images, bounded by count (`cacheSize`, default 200) and by total bytes (`cacheBytes`, default 64 MB); the oldest entries go first, and an image larger than `cacheBytes` is not kept. Production caching belongs in the CDN.

### 12.2 Metadata route

Not part of the public server. `createMetaApp` is a separate Hono app for the demo and local tooling, mounted at its own path (e.g. `/_meta`) so it cannot collide with source paths: `GET /{src}` there It returns `{ width, height, thumbhash, color }` with `color` as `#rrggbb`.

### 12.3 Tooling

`computeMetadata(fileOrBuffer)` returns `{ width, height, thumbhash, color }` for scripts that store metadata in a CMS or database. The result feeds `srcWidth`, `srcHeight`, `placeholder` and `version`.

### 12.4 CDN notes

- **CloudFront.** The managed `CachingOptimized` policy excludes query strings. Use a cache policy with a query-string allowlist of `ar fmt q v w`. CloudFront keys on raw order and case, which the canonical URL takes care of.
- **Cloudflare.** Caches by file extension by default, so the URL must end in the source's extension (it does) or a Cache Rule must mark the path cacheable. Query strings are part of the default key; sorting is not needed because the URL is canonical.
- Both CDNs collapse concurrent misses for one key; the server does the same (12.1).

## 13. Demo

- **Network:** real speed or throttled (presets plus custom latency and bandwidth). The throttle applies only to the image route (`/_img`).
- **Controls:** loading strategy, preload distance, dwell time, fade duration, placeholder kind (color / ThumbHash / none), and a reload button for a cold browser cache.
- **Per image:** state, measured box width, delivered width and format, bytes and load time.
- **Comparison:** a "naive" column with what a `sizes="100vw"` srcset would have downloaded, to make the savings visible.
- **Sections:** fixed, ratio, fill, external image, priority hero and a long scroll gallery.

## 14. Testing

- Unit: client and server ladders and number formatting agree, width snapping, ratio-ladder snapping (all modes agree), candidate cap (2× and `srcWidth`), canonical URL building, loader URLs for the default and the three known third-party mappings, owned/external detection (protocol-relative, `data:`, ports, case), placeholder parsing (`thumbhash:` prefix, color, data URI).
- Component (jsdom, mocked IntersectionObserver and ResizeObserver): state transitions, no URL before intersection, monotonic `sizes` updates and the debounce, fade only after decode and the decode timeout fallback, `complete && naturalWidth === 0` as error, placeholder output, dev warnings and dev errors for invalid prop combinations.
- SSR: `renderToString` output per mode, classic-mode images at `opacity: 1`, only the average color for ThumbHash unless opted in, `<noscript>` markup unescaped, no DOM access during render, hydration without mismatch.
- Server: canonical-parameter validation (order, case, duplicates, number formats), ladder validation, crop dimensions, no upscaling, path safety (including backslashes and Unicode), metadata stripping, limits (pixel count, file size, timeout), ETag/304, HEAD.
- E2E (Playwright, Chromium plus WebKit): no image requests below the fold, the right width per DPR with the 2× cap, an upgrade on resize through the `sizes` mutation in WebKit, the placeholder in the first paint, no progressive paint for measured-mode images, the priority image visible before hydration.

## 15. Decisions (formerly open questions)

1. **Fill-mode ratio quantization.** A log-spaced ratio ladder shared by all modes (6.1), not linear rounding. 2.2 % maximum error, 73 values, one variant per visual ratio.
2. **Format for server-rendered images.** WebP only. `<picture>` would double-fetch the LCP image through typed preload links, and AVIF is the most expensive format to encode on a per-request backend. Revisit when the CDN can normalize `Accept`.
3. **Fade for server-rendered priority images.** No fade and no decode gating for any classic-mode image (9). An image that has started painting is never hidden.
4. **Format-detection wait.** Kept, but detection starts at provider mount, is bounded by a 200 ms WebP fallback, and is skipped for loaders with `formats: 'auto'`. The first images do not start with WebP: it would save nothing measurable and split the cache.
5. **`sizes` updates during continuous resizing.** `sizes` is monotonic, written only when the snapped candidate changes, debounced 200 ms trailing. Extra downloads happen only when a ladder step is crossed, which is a legitimate upgrade.

## 16. Changes from the 2026-11-03 review

- Classic-mode images no longer fade or wait for `decode()`; they are visible from the first paint (B1).
- Fixed-mode box CSS uses `aspect-ratio` instead of an explicit height (B2).
- The default loader strips the origin from `domains` URLs; the backend keeps rejecting absolute URLs (B3).
- URL contract: `v` version parameter, canonical parameter order and number format, source path in the URL path, backend rejects non-canonical strings; CDN notes added (I1).
- ThumbHash renders as average color on the server and as the decoded image after hydration; full server decoding is opt-in (I2).
- Layout-mode precedence and invalid prop combinations defined; `fill + aspectRatio` is a crop hint; `priority`/`native` without `width` or `sizes` is an error (I3).
- Measured-mode cost documented, dev warning for first-viewport images, detection starts at provider mount (I4).
- `decode()` is raced against a timeout, stale decodes ignored, broken `complete` images are errors (I5).
- Candidates capped at 2× and at `srcWidth`; `snap(3w)` dropped; ladder gets 1440 and 2560 (I6).
- Ratio ladder replaces 2-decimal rounding in every mode (I7).
- Loader is an object with `widths`, `ratios`, `qualities`, `formats`; function form stays as shorthand; `version` and `params` added to the request (I8).
- Backend limits, coalescing, timeout, metadata stripping, SVG/TIFF/animated sources rejected, `/meta` opt-in, Windows path rules (I9).
- `sizes` monotonic; WebKit resize behavior documented (I10).
- Minor: hidden-image claim scoped to measured mode, `scrollMargin`, `sizes="auto"` dropped, richer `<noscript>`, `thumbhash:` prefix, CSP note, reduced motion, `onLoad` semantics, `ref`, `src` change, `decoding`, preload dedupe rule, ETag/304/HEAD/nosniff, owned-detection rules, `fmt=auto` and public `/meta` cut.

## 17. Changes from the 2026-11-03 performance and simplicity review

- `<noscript>` uses the classic candidates (two when `width` is known) and is memoized (6.2, 7.3).
- ThumbHash decoding waits for the load trigger in measured mode (8).
- A known format detection result is read synchronously (6.4).
- One shared `ResizeObserver` reading the content rect; boxes that cannot grow are not observed (6.2).
- `params` removed from `ImageRequest`; `createLoader({ params })` stays (6.1).
- Server: `concurrency` defaults to half the CPUs, the LRU is also bounded by bytes, memory per render documented, the root's `realpath` is resolved once, sharp's `limitInputPixels` is the only pixel check, the timeout's two layers (504 response, sharp's work limit) are spelled out, `avifEffort` option (12.1).
