# Migrating from 0.2 to 0.3

This guide covers the changes from 0.2 to 0.3. All lazy-ease packages are released under one version, so upgrade them together.

| Existing usage | 0.3 behavior | Migration |
| --- | --- | --- |
| React Image and provider | Existing import paths remain supported. React uses shared core. | Keep your public React imports. Use core directly for framework-free code. |
| sizes on a normal image | The template can prepare candidates and still fade after activation. | Choose loading="native" when the real source must appear immediately in SSR HTML. Use priority for a visible LCP hero. |
| Measured image with automatic noscript | No-JS fallback is opt-in. | Set noScript on the image to request fallback markup, or use native HTML for articles that must survive a failed bundle. |
| Wrapper expected everywhere | Box emitted when layout, fade, focal positioning or wrapper props need it. | Passing wrapperStyle or wrapperClassName preserves the element. Update selectors that assume every img has a span parent. |
| width with sizes | A known width caps the candidates at its 1× and 2× widths, also under sizes; sizes no longer offers the full ladder. Without both source dimensions the image gets one URL, the largest request for the slot. | Responsive candidate lists now need trusted output dimensions: pass srcWidth and srcHeight from your metadata. Drop width (keep height or aspectRatio for the box) when a free slot should offer the full ladder. |
| Error placeholder | A failed first load removes the placeholder and shows the alt text or the browser's broken-image presentation in the reserved area, with data-state="error". | Style `[data-state="error"]` if you want a different error look; the reserved geometry stays. |
| Fill with no ratio | With source dimensions the default is browser crop; the measured server crop remains available explicitly. | Set crop="server" for the former measured behavior and authorize the crop set at the backend. |
| onLoad as a display signal | Real first-load events retain their React event signature. An already displayed image can be adopted before the listener exists. | Use onStateChange for first display including adoption. Width upgrades keep the loaded state. |
| ThumbHash string | Decoder is opt-in. | Register the optional decoder in the chosen adapter or provide a server-generated color/data URI. Inspect your bundle after opting in. |
| SVG or animated GIF sent through the loader | The default path preserves the original. | Serve the original with appropriate dimensions and MIME type. |
| Server in-memory cache | Default storage is a bounded disk directory, `.cache/lazy-ease` under the working directory, owned by one process. `cacheSize` and `cacheBytes` are gone and throw. | Pass `storage: diskStorage({ dir, maxBytes })` with writable space outside the source root, one directory per process, or `storage: memoryStorage({ maxEntries, maxBytes })` for the 0.2 behavior. |
| Arbitrary v or unbounded crops | Revisions and crop sets participate in admission and cache policy. | Publish revision metadata and allowed crops. Update CDN keys for fx/fy and apply authorization before a hit. |

For example, preserve early native discovery for an article:

```tsx
// 0.2
<Image src="/article.jpg" alt="Footpath" sizes="100vw" />

// 0.3, native discovery with reserved intrinsic geometry
<Image src="/article.jpg" alt="Footpath" loading="native" sizes="100vw"
       srcWidth={1600} srcHeight={1000} />
```

A fixed width now caps the candidates, also with `sizes`, and only trusted source dimensions produce a list:

```tsx
// 0.2: 11 candidates, 64w to 1920w, because sizes lifted the width cap
<Image src="/a.jpg" alt="Fern" width={320} height={240} sizes="100vw"
       srcWidth={2400} srcHeight={1800} />
// 0.3: 2 candidates, 384w and 640w (1× and 2× of width, snapped to the ladder)
<Image src="/a.jpg" alt="Fern" loading="native" width={320} height={240} sizes="100vw"
       srcWidth={2400} srcHeight={1800} />

// 0.2: 13 candidates, 64w to 3840w, labeled with request widths
<Image src="/a.jpg" alt="Fern" width={320} height={240} sizes="100vw" />
// 0.3: no srcset, one src for the largest request (w=640): without both
//      source dimensions the encoded widths are unknown
<Image src="/a.jpg" alt="Fern" loading="native" width={320} height={240} sizes="100vw" />
```

For a list that follows a free slot, pass `srcWidth` and `srcHeight` from your metadata and leave out `width`.

To retain a measured gallery's server crop, change
`<Image src="/fern.jpg" alt="Fern" fill />` to
`<Image src="/fern.jpg" alt="Fern" fill crop="server" />`.
For a gallery with freely changing ratios, pass oriented dimensions and let browser crop use one uncropped source ladder.

When migrating private images, configure user access independently from optional crop tokens. Roll out matching server admission and CDN configuration before shipping clients that send new URL fields. See the [backend guide](backend.md) and [recipes](image-recipes.md).

With the reference server, check existing URLs before switching:

1. Every URL needs `q`. 0.3 loaders always write it; hand-written or cached 0.2 URLs without it are a 400.
2. A `v` must name the source's current revision, from `computeMetadata().revision` or your own upload record through the server's `policy`. A URL with another `v` is a 404; a URL without `v` keeps working with revalidation instead of immutable caching.
3. Uncropped and centered ladder crops keep working. A focal crop needs the source's recorded focus in its policy, a listed crop or a crop token.
4. Add `token` to the CDN cache key, or verify it on the viewer-request path first. Authorize private viewers there too, before any hit.
5. Then ship templates and clients that write `v`, focal points and tokens.
