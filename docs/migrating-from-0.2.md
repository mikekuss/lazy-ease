# Migrating from 0.2 to 0.3

This guide describes the planned release boundary. Core extraction preserves 0.2 React behavior while the controller is developed and tested independently. Upgrade the public packages together when 0.3 ships.

| Existing usage | 0.3 behavior | Migration |
| --- | --- | --- |
| React Image and provider | Existing import paths remain supported. React uses shared core. | Keep your public React imports. Use core directly for framework-free code. |
| sizes on a normal image | The template can prepare candidates and still fade after activation. | Choose loading="native" when the real source must appear immediately in SSR HTML. Use priority for a visible LCP hero. |
| Measured image with automatic noscript | No-JS fallback is opt-in. | Set noScript on the image to request fallback markup, or use native HTML for articles that must survive a failed bundle. |
| Wrapper expected everywhere | Box emitted when layout, fade, focal positioning or wrapper props need it. | Passing wrapperStyle or wrapperClassName preserves the element. Update selectors that assume every img has a span parent. |
| Fill with no ratio | With source dimensions the default is browser crop; the measured server crop remains available explicitly. | Set crop="server" for the former measured behavior and authorize the crop set at the backend. |
| onLoad as a display signal | Real first-load events retain their React event signature. An already displayed image can be adopted before the listener exists. | Use onStateChange for first display including adoption. Width upgrades keep the loaded state. |
| ThumbHash string | Decoder is opt-in. | Register the optional decoder in the chosen adapter or provide a server-generated color/data URI. Inspect your bundle after opting in. |
| SVG or animated GIF sent through the loader | The default path preserves the original. | Serve the original with appropriate dimensions and MIME type. |
| Server in-memory cache | Default storage is a bounded disk directory. | Configure writable disk space and a quota, or choose RAM-only mode explicitly. |
| Arbitrary v or unbounded crops | Revisions and crop sets participate in admission and cache policy. | Publish revision metadata and allowed crops. Update CDN keys for fx/fy and apply authorization before a hit. |

For example, preserve early native discovery for an article:

```tsx
// 0.2
<Image src="/article.jpg" alt="Footpath" sizes="100vw" />

// 0.3, native discovery with reserved intrinsic geometry
<Image src="/article.jpg" alt="Footpath" loading="native" sizes="100vw"
       srcWidth={1600} srcHeight={1000} />
```

To retain a measured gallery's server crop, change
`<Image src="/fern.jpg" alt="Fern" fill />` to
`<Image src="/fern.jpg" alt="Fern" fill crop="server" />`.
For a gallery with freely changing ratios, pass oriented dimensions and let browser crop use one uncropped source ladder.

When migrating private images, configure user access independently from optional crop tokens. Roll out matching server admission and CDN configuration before shipping clients that send new URL fields. See the [backend guide](backend.md) and [recipes](image-recipes.md).
