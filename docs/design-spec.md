# lazy-ease design specification

**Target: 0.3.0, approved design for implementation.** The root README describes the shipped 0.2 API. The [0.2 design](https://github.com/mikekuss/lazy-ease/blob/6c9043f37909bc8af6c8ab64782b13cc9f510c00/docs/design-spec.md) records the baseline, including the focal-window math, prop precedence and existing loader API. This document governs 0.3. See the [recipes](image-recipes.md), [backend contract in practice](backend.md) and [migration guide](migrating-from-0.2.md).

## Packages and cost

All public packages share one release version. Core exports pure functions and a framework-free controller. Vanilla depends on core and supplies HTML enhancement, CSS as a file and string, and a self-starting script. React depends on core and retains its framework peers. Server uses core's ladders, number formatting and crop geometry. Testing publishes JS helpers and portable JSON fixtures, also attached to each release. Multiple instances and copies can coexist on one page.

ESM imports must perform no detection, DOM access, observer setup or ladder computation. Use functions, static ladder data and lazy initialization. Keep optional ThumbHash decoding in an explicit entry point. A browser ESM import must work without a Node process global. The standalone IIFE is explicitly activated by its script tag. Preserve stylesheet imports in production bundles.

Measure each public import plus required core code with a pinned minifying bundler, production defines, external React peers and Brotli quality 11. Budgets in bytes: createLoader 1000, attach with controller creation 3500, enhance with controller 4000, self-starting IIFE 4500, CSS 500, final React Image 5000. During compatible extraction the existing Image ceiling is 7557 under the review baseline (esbuild 0.28.2, ES2022 ESM). Publish the exact measurement fixtures with the checks.

## Loading and markup

Source selection and display timing are independent. A template can generate all URLs and still request a fade.

| Mode | HTML before activation | Owner after activation |
| --- | --- | --- |
| Prepared fade | Inline placeholder and deferred candidates or single URL | Controller copies the supplied values on intersection. It needs no loader or layout read for a prepared slot. |
| Measured fade | Inline placeholder and logical source | Controller measures the slot, calls the loader and installs candidates. |
| Native / priority | Real sources and sizes in the initial HTML | Author or framework owns the sources. The browser discovers and displays them directly. |
| Decorative background | Placeholder rule and a visibility-gated CSS rule | JS sets the visibility marker once. CSS selects the image. |

A marked image or its nearest marked box owns one logical image, possibly inside picture. Use img.closest('[data-le]') within its tree. The template supplies every DOM node. Default to a box with an inline one-pixel SVG background placeholder. Support boxless native images with a color, or a deferred boxless image with a data-URI source and hard swap. For boxed deferred images, an inert inline image source makes the initial img valid. Its load, complete flag and dimensions describe the placeholder until the target is assigned. A box is required for a crossfade, fill, browser focal positioning or explicit React wrapper props. Supply alt on img. Reserve geometry at first paint using dimensions, aspect-ratio or the positioned fill parent. Document CSP requirements for data images and inline styles, and support author CSS for placeholders and geometry.

| HTML field | Meaning |
| --- | --- |
| data-le | Marker on the box or img. The default IIFE scans only explicitly opted-in areas (data-le-auto on their root). |
| data-le-srcset / data-le-sizes | Precomputed candidate list and slot. Activate sizes before srcset. |
| data-le-url | Precomputed single target URL. Use when dimensions are unknown or for pass-through. |
| data-le-src | Logical source for the configured measured loader. |
| data-le-srcw / data-le-srch | Oriented source dimensions. |
| data-le-ar / data-le-fill / data-le-crop | Layout ratio, boolean fill and server or browser crop. Native width and height remain meaningful HTML dimensions. |
| data-le-fx / data-le-fy | Optional focal coordinates in percent, supplied together. |
| data-le-token / data-le-v / data-le-q | Optional crop token, revision and quality passed to the loader. |
| data-state / data-le-visible | Controller state on the marked owner, or a one-way visibility marker on a decorative background. |

Use one source mode per image. A prepared list may include a prepared fallback URL. Reject ambiguous measured and prepared input before mutating the element. For deferred picture markup put media, type and dimensions on source elements and defer their srcset/sizes as on img. Native picture uses standard attributes throughout. Calls to enhance(le, root) accept a document, element or shadow root. Roots for markup discovery and for intersection are separate options. React and Lit attach within their own lifecycle. Skip their managed subtrees during auto-enhancement. An element-local, cross-copy ownership marker prevents duplicate attachment. Only its owner releases it. Shadow-root users can adopt the exported CSS string.

createLazyEase(config) returns an instance with attach(img, options) returning a destroy handle. The adapter renders initial static markup before hydration. After attach, the controller owns deferred source attributes, dynamic state, fade and placeholder styles. Re-renders must preserve those values. Destroy releases listeners, observers, timers and ownership. Adoption preserves an already displayed target. Changing the logical source starts a new generation with its own placeholder. Stale completions cannot mutate that generation.

## Display lifecycle

1. Show the placeholder before client code. Deferred images default to lazy with shared IntersectionObserver pools by root identity and effective margin. Keep the existing 400px default preload distance and optional dwell. Account for nested clipping. Dispose empty pools.
2. Use ResizeObserver content-box entries for measured images. Ignore zero-sized slots. Separate reads and writes, avoid synchronous layout and per-frame loops. Batch changes and preserve the existing trailing 200 ms resize debounce. Grow the offered ladder when needed. Browser crop needs the cover slot even if only the height grows.
3. Set visibility before activating target URLs. Apply sizes before srcset and coordinate picture sources and fallback to avoid interim requests. Suppress idle alt-text flash while keeping accessible text.
4. After successful load and decode, fade once (default 400 ms). Reduced motion or zero duration swaps directly. After a successful load, a bounded decode timeout may reveal directly. A failed initial load/decode releases the placeholder, restores error/alt presentation, preserves the reserved area and reports error. Remove the placeholder after the fade for transparent assets.
5. Keep the displayed target during resolution upgrades. An upgrade failure retains that image. Report idle, loading, loaded or error through onStateChange(state, img). Report first display once per logical source including successful cache adoption. React onLoad retains its event signature when an actual first load event is observed. Adoption never fabricates an event.
6. Native images remain visible through late enhancement. Priority implies eager discovery, high fetch priority and no fade. Match any responsive preload to the selected source, media, MIME type, candidates, sizes and credentials. At most preload the first eligible source under its own conditions. Prefer early picture markup when a matching preload adds no benefit.

No-JS fallback for deferred images is opt-in in both adapters. A noscript element helps with disabled scripting. A failed bundle leaves the deferred placeholder. Native HTML works in both cases. Native errors use browser presentation.

## Geometry, format and URL contract

Preserve fill, fixed, ratio and intrinsic layout modes. Emit CSS lengths with units in neutral style records. Use oriented source dimensions to reserve intrinsic article ratio even without a declared rendered width. Each art-direction source has its own media, source, dimensions, ratio, optional focal point and optional token. Supply breakpoint geometry on source and fallback images or through consumer CSS using aspect-ratio: var(--le-ar) on the box.

Server crop uses the nearest allowed ratio and the oriented crop window centered on the optional focal point, clamped to source edges. Normalize finite focus coordinates to integer percent (0–100); omit center. For browser crop request the uncropped source, use object-fit: cover and container-relative object positioning. Given source ratio R, use cover width max(boxWidth, boxHeight × R). Fill without an explicit ratio defaults to browser crop when both source dimensions are known, otherwise server crop when geometry can be measured. A native template with unknown crop geometry must supply an approved crop or uncropped fallback.

Keep the 0.2 default ladders: 13 widths from 64 to 3840, 73 ratios, quality 75. Custom small ladders and explicit format capabilities must work at both ends. Measured candidates cap at the ladder step for twice the effective slot. The browser selects the candidate. Fixed classic candidates offer snapped 1× and 2×. Free sizes can offer the full permitted ladder. Calculate actual output dimensions from oriented geometry, rounded crop window and no-upscale rules. Label each candidate with the actual encoded width, deduplicate identical outputs and emit a single src when appropriate. Without trusted metadata or a variant manifest, a single optimized URL is sufficient.

createLoader accepts formats. Probe only declared formats when a choice is needed; a single format or an auto-negotiating third-party loader can bypass probing. Explicit fmt is required on the reference backend. External URLs remain direct. Detect SVG by pathname extension or SVG data MIME type. Pass animated GIFs through; GIF with unknown animation status defaults to original. Preserve animation, layout and applicable lazy behavior. Optimized animation is a later release.

Reference URLs use encoded NFC source-path segments and ordered keys ar, fmt, fx, fy, q, token, v, w. Omit absent optional fields. Use canonical numbers (up to three decimal places, no exponent or trailing zeros); preserve case of opaque values. Emit q explicitly. Keep one spelling per public variant or normalize before cache lookup. Validate configured widths, ratios, formats and quality before rendering. Reject inconsistent focus and ambiguous or malformed input. A crop token is optional, scoped to source identity, revision and crop including focus. Width, format and quality remain bounded independently. Define interoperability bytes and matching fixtures before enabling signing. Viewer authentication is a separate check.

For one revision with all default crops admitted, the upper bound is 13 × 3 × (1 + 73 × 101²) = 29,042,286. A single approved crop admits at most 39 outputs with the default width/format/quality sets. Configure finite per-source crop permissions in public tokenless mode. See the [backend guide](backend.md) for storage and capacity requirements.

## Verification

Require unit, cross-language fixture, packed-package and real-browser coverage. Browser fixtures cover first paint, disabled and failed JS, event adoption, accurate descriptors, nested scroll roots, destruction, several bundles, Shadow DOM, reduced motion, Firefox/Chromium/WebKit and request counts through resize and breakpoint changes. Measure LCP, CLS and interaction latency on a separate lightweight page. Report environment and trace methodology. A lab trace or Lighthouse TBT is not field INP. Compare delivery bytes and variant counts at 1× and 2× before revising ladders.
