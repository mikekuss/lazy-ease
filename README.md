# lazy-ease

Lazy-loaded, right-sized images for React 19, with an inline placeholder and a crossfade.

**[Live demo](https://mikekuss.github.io/lazy-ease/)**. The hosted demo serves pre-rendered variants through a static loader, so arbitrary measured fill ratios aren't available there; run it locally (see [Development](#development)) for the full behavior.

```tsx
import { Image } from '@lazy-ease/react'

<Image src="/photos/lake.jpg" alt="Lake at dawn" width={320} height={240} />
```

What it does:

1. **Less data.** Every image is delivered at the size it is rendered at (× device pixel ratio, capped at 2), cropped on the server and in AVIF or WebP.
2. **No layout shift.** Fixed sizes, aspect ratios and fill boxes reserve their space before the image arrives, including after a resize or rotation.
3. **No unnecessary loads.** Off-screen images aren't requested until they approach the viewport. In the default (measured) mode, images hidden with `display: none` are never requested.
4. **A placeholder on first paint.** The placeholder is an inline style in the server HTML: a color, a data URI or a [ThumbHash](https://evanw.github.io/thumbhash/), with no extra request.
5. **Ratios and fixed widths** are both first-class.

| Package | |
| --- | --- |
| [`@lazy-ease/react`](packages/react) | The `<Image>` component, `<LazyEaseProvider>` and the loader interface. Needs React 19. |
| [`@lazy-ease/server`](packages/server) | The reference image backend (Node, [Hono](https://hono.dev) and [sharp](https://sharp.pixelplumbing.com)) and metadata tooling for upload or build scripts. |
| [`apps/demo`](apps/demo) | Demo with network throttling. Not published. |

## Install

```bash
npm install @lazy-ease/react
```

`@lazy-ease/server` (Node 22+) isn't on npm yet. Until it is, use it from this repository, or bring your own backend through a [custom loader](#loaders).

`@lazy-ease/react` has `react` and `react-dom` 19 as peer dependencies.

## Quick start

Mount the image app at `/_img`, the default loader's `baseUrl`:

```ts
// server.ts
import { serve } from '@hono/node-server'
import { createImageApp } from '@lazy-ease/server'
import { Hono } from 'hono'

const app = new Hono()
app.route('/_img', createImageApp({ root: './images' }))
serve({ fetch: app.fetch, port: 3001 })
```

Then render images. The provider is optional; mounting one starts format detection early and sets defaults for its subtree:

```tsx
import { Image, LazyEaseProvider } from '@lazy-ease/react'

export function App() {
  return (
    <LazyEaseProvider rootMargin="800px" placeholder="#e5e7eb">
      {/* LCP image: URLs in the server HTML, preloaded with high priority */}
      <div style={{ position: 'relative', aspectRatio: 2 }}>
        <Image src="/hero.jpg" alt="…" fill aspectRatio={2} sizes="100vw" priority />
      </div>

      <Image src="/photos/lake.jpg" alt="…" width={320} height={240} />
      <Image src="/photos/lake.jpg" alt="…" aspectRatio={16 / 9} placeholder="#5b6c8f" />
    </LazyEaseProvider>
  )
}
```

`/photos/lake.jpg` is read from `./images/photos/lake.jpg`. If the page and the image server have different origins, proxy `/_img` or pass `createLoader({ baseUrl: 'https://img.example.com/_img' })` as the provider's `loader`.

## `<Image>` props

| Prop | Type | Default | Behavior |
| --- | --- | --- | --- |
| `src` | `string` | required | Path or URL of the source image. Changing it resets the state to `idle` and shows the placeholder again. |
| `alt` | `string` | required | Passed to `<img>`. |
| `width` | `number` | | Rendered width in CSS px. |
| `height` | `number` | | Rendered height in CSS px. Only valid together with `width`. |
| `aspectRatio` | `number` | | Box ratio in ratio mode. In fill mode, the crop ratio sent to the backend instead of the measured one. |
| `fill` | `boolean` | `false` | The box fills its positioned parent. |
| `sizes` | `string` | measured | Classic `sizes`. Turns off measuring and offers the full width ladder (classic mode). Wins over `width` for candidate selection. |
| `srcWidth`, `srcHeight` | `number` | | Intrinsic size of the source, from `computeMetadata`. Widths above `srcWidth` aren't offered, since the backend never upscales. Optional but recommended. |
| `focalPoint` | `{ x, y }` | center | The point to keep in view when the image is cropped, in percent of the source (0–100). See [Focal point](#focal-point). |
| `version` | `string` | | Opaque cache-busting token (content hash or mtime), sent as `v`. |
| `quality` | `number` | provider (`75`) | Snapped to the nearest quality the loader allows. |
| `loading` | `'lazy' \| 'native' \| 'eager'` | provider (`'lazy'`) | See [Loading](#loading). `native` requires `width` or `sizes`. |
| `rootMargin` | `string` | provider (`'400px'`) | Preload distance for `lazy`. |
| `priority` | `boolean` | `false` | Eager, `fetchpriority="high"` and a preload link. Requires `width` or `sizes`. For the LCP image only. |
| `placeholder` | `string` | provider (`'#e5e7eb'`) | A CSS color, a data URI, `thumbhash:<base64>` or `'none'`. See [Placeholders](#placeholders). |
| `fadeDuration` | `number` | provider (`400`) | Crossfade in ms for measured-mode images. `0` swaps instantly after decode. Classic-mode images never fade. |
| `unoptimized` | `boolean` | auto | Forces external-image behavior: `src` as is, no `srcset`. |
| `loader` | `ImageLoader` or function | provider | Per-image loader. Ignored on external images, with a development warning. |
| `onLoad`, `onError` | | | Passed through. `onLoad` fires once, for the first displayed image; later `srcset` upgrades aren't surfaced. |
| `ref` | | | Forwarded to the `<img>`. |
| `className`, `style` | | | Applied to the `<img>`. |
| `wrapperClassName`, `wrapperStyle` | | | Applied to the box, the `<span>` around the `<img>`. |

Any other `<img>` attribute (`crossOrigin`, `referrerPolicy`, `decoding`, …) is passed through. `decoding` defaults to `"async"`.

The box carries `data-state="idle" | "loading" | "loaded" | "error"` for styling and tests.

### Layout modes

The mode follows from the props, in this order:

| | Mode | Props | Box | Crop sent to the backend |
| --- | --- | --- | --- | --- |
| 1 | **fill** | `fill` | `position: absolute; inset: 0` | `aspectRatio` if given, otherwise the measured box ratio. In classic mode without `aspectRatio`: none, `object-fit` crops. |
| 2 | **fixed** | `width` and `height` | `width: {w}px; max-width: 100%; aspect-ratio: {w} / {h}` | `w / h` |
| 3 | **ratio** | `aspectRatio`, with or without `width` | `width: {w}px` or `100%`; `aspect-ratio: {r}` | `r` |
| 4 | **intrinsic** | only `width`, or nothing | `width: {w}px` or `100%`, height from the image | none |

In fill, fixed and ratio mode the `<img>` is `width: 100%; height: 100%; object-fit: cover`. `fill` needs a positioned parent; the component doesn't add one. Intrinsic mode can't reserve a height, so it shifts the layout when the image loads, and logs a development warning saying so.

Every crop ratio is snapped to a shared ratio ladder (73 values from 0.25 to 4, at most 2.2 % apart, with `4/3`, `3/2`, `16/9`, `21/9` and their inverses on it). A 4:3 box is the same variant whether it came from `width`/`height`, `aspectRatio` or a fill measurement; `object-fit: cover` hides the difference.

These combinations throw in development: `height` without `width`; `fill` with `width` or `height`; `width`, `height` and `aspectRatio` together; `priority` or `loading="native"` without `width` or `sizes`.

### Provider

`<LazyEaseProvider>` sets defaults for its subtree. Nested providers merge with their parent.

| Option | Default | |
| --- | --- | --- |
| `loader` | `createLoader({ baseUrl: '/_img' })` | The loader object or function (see [Loaders](#loaders)). |
| `domains` | `[]` | Extra hosts treated as owned, besides relative paths (see [External images](#external-images)). |
| `quality` | `75` | |
| `loading` | `'lazy'` | |
| `rootMargin` | `'400px'` | |
| `dwellTime` | `0` | How long, in ms, a box must stay in the preload zone before it loads. Leaving earlier requests nothing, so fast flings through a long gallery stay cheap. |
| `placeholder` | `'#e5e7eb'` | |
| `fadeDuration` | `400` | |
| `thumbhashSsr` | `'color'` | `'image'` renders decoded ThumbHash images in the server HTML instead of only their average color. |

## Focal point

`focalPoint={{ x, y }}` keeps a point of the source in view when the image is cropped. `x` and `y` are percent of the source's width and height (0–100), rounded to whole percent. The point ends up as close to the box center as the image edges allow, the way imgix's `fp-x`/`fp-y` and Cloudflare's `gravity` work. That is not `object-position: x% y%`, which lines up the image's `x%` with the box's `x%`.

```tsx
<div style={{ position: 'relative', height: 200 }}>
  <Image src="/banner.jpg" alt="…" fill sizes="100vw" priority srcWidth={1600} srcHeight={500} focalPoint={{ x: 70, y: 60 }} />
</div>
```

- **On the server.** When the request has a crop ratio, `focalPoint` goes into the `ImageRequest` and `createLoader()` writes it as `fx` and `fy`. The server cuts the largest window of that ratio from the source, placed around the point, then scales it. A new focal point is a new URL, so it loads a new variant. The center is the default and is never sent, so URLs without a focal point don't change.
- **In the browser.** The box becomes a size container (`container-type: size`) and the `<img>` gets an `object-position` written in container units, so it is right in the server HTML and after every resize, without script. It covers what the server doesn't crop: images without a crop ratio (classic fill without `aspectRatio`, external images) and the up to 2.2 % the ratio ladder leaves over. It needs the source ratio, so pass `srcWidth` and `srcHeight`; without them an uncropped image falls back to `object-position: x% y%` with a development warning.
- **Placeholder.** An image placeholder (data URI or decoded ThumbHash) moves from the box to a layer inside it and is placed the same way. Colors stay on the box.
- Intrinsic images are never cropped, so `focalPoint` does nothing there.

A custom loader whose backend crops must keep `focalPoint` as close to the crop's center as the source edges allow, or the browser's positioning won't match.

## Measured and classic mode

**Measured mode** is the default for owned images. Before the box is near the viewport, the `<img>` has no `src` or `srcset`. When it gets close, the component measures the box and sets `sizes` to the measured width (e.g. `sizes="412px"`) and `srcset` to the width ladder up to twice that width, so the browser picks the candidate for its device pixel ratio. A `ResizeObserver` keeps `sizes` current: it only grows, and only when the browser would pick another candidate (debounced 200 ms), so resizing never downgrades and only a real step up downloads anything. In fill mode without `aspectRatio`, the crop follows the box ratio. The format is the best one the browser decodes, found by a one-time test (AVIF, then WebP, then JPEG; WebP if the test takes longer than 200 ms).

**The cost:** a measured image waits for hydration, intersection and measuring, and the browser's preload scanner never sees it. For images likely in the first viewport, use **classic mode**, which puts the URLs in the server HTML. In development, the component warns when a measured-mode image is already in the viewport when it mounts.

Classic mode applies when `sizes` is set, with `priority`, or with `loading="native"`:

- With `sizes`: the full ladder (capped at `srcWidth`) and your `sizes`.
- With `width` and no `sizes` (fixed or ratio mode): two candidates, `width` and `2 × width` snapped to the ladder, with `sizes="{width}px"`.
- The format is always WebP, since nothing can be detected before JavaScript runs. Every target browser decodes it, and there's no `<picture>`, which would make AVIF-capable browsers fetch the LCP image twice through typed preloads.
- Classic images are visible from the first paint and never fade, so the browser can count them for LCP.

Use `priority` for the LCP image only, `sizes` for other images likely above the fold, and measured mode for everything else.

## Loading

| `loading` | Behavior |
| --- | --- |
| `lazy` (default) | A shared `IntersectionObserver` per `rootMargin`. The load starts when the box comes within `rootMargin` of the viewport. Hidden boxes never intersect, so they never load. With `sizes`, the image is classic and uses the browser's `loading="lazy"` instead. |
| `native` | URLs in the HTML with `loading="lazy"`; the browser decides when to load (Chrome: about 1250 px ahead on fast connections, 2500 px on slow ones). Classic mode only. The browser still fetches hidden images. |
| `eager` | Loads right away. |

`priority` implies eager loading, `fetchpriority="high"` and a `<link rel="preload" as="image" imagesrcset imagesizes fetchpriority="high">` emitted through React's `preload()`. The link and the `<img>` are built from the same strings, so the browser fetches the image once.

**Nested scroll containers.** Inside a carousel or an `overflow: auto` panel, `rootMargin` has no effect along that container's scroll axis: the container clips before the margin applies. Where `IntersectionObserver` supports `scrollMargin` (Chromium 120+) the component passes the same value; elsewhere such images load when they become visible.

## Placeholders

The placeholder is an inline style on the box, so it's in the server HTML and painted on the first frame with no request.

| `placeholder` | Rendered as |
| --- | --- |
| A CSS color: `#5b6c8f`, `rgb(…)`, `hsl(…)`, a named color | `background-color` |
| A data URI: `data:image/…` | `background-image`, `background-size: cover` |
| `thumbhash:<base64>` | See below |
| `'none'` | Nothing |

Without the prop, the provider's neutral color is used, for external images too. An invalid value falls back to it with a development warning. The background is removed once the image has loaded (after the fade), so transparent images don't show it.

**ThumbHash.** A decoded ThumbHash is an uncompressed PNG data URI of about 5.5 KB of base64 per image. So the server HTML gets only the hash's average color, and on the client the component decodes the hash (memoized) and sets it as the background of images that haven't loaded yet: measured-mode images when they near the viewport, so off-screen images never decode, and classic-mode images right after hydration. With `thumbhashSsr: 'image'` on the provider, or `priority` on the image, the decoded image goes into the server HTML instead. That's meant for the hero.

**Metadata.** Compute placeholders, sizes and versions once, at upload or build time, and store them with the image:

```ts
import { computeMetadata } from '@lazy-ease/server'

const { width, height, thumbhash, color } = await computeMetadata('./images/photos/lake.jpg')
// width, height: size after EXIF rotation, for srcWidth and srcHeight
// thumbhash: base64, for placeholder={`thumbhash:${thumbhash}`}
// color: dominant color as #rrggbb, usable as placeholder directly
```

```tsx
<Image
  src={photo.src}
  alt={photo.alt}
  fill
  srcWidth={photo.width}
  srcHeight={photo.height}
  version={photo.hash}
  placeholder={`thumbhash:${photo.thumbhash}`}
/>
```

`computeMetadata` also takes a `Buffer`. For local tooling, `createMetaApp({ root })` serves the same object as JSON at `GET /{src path}`. Mount it on its own path, never on the public image route:

```ts
import { createMetaApp } from '@lazy-ease/server'

app.route('/_meta', createMetaApp({ root: './images' }))
```

### Content Security Policy

Placeholders and layout are inline `style` attributes, and decoded ThumbHash placeholders are `data:` URIs. With a strict CSP, allow both:

```
style-src-attr 'unsafe-inline';
img-src 'self' data:;
```

`style-src-attr 'unsafe-inline'` (CSP level 3) covers style attributes only, not `<style>` elements; on browsers without `style-src-attr`, `style-src` applies. Instead of `'unsafe-inline'`, you can allow the attributes with hashes (`'unsafe-hashes'` plus a `'sha256-…'` per distinct style). `img-src data:` is only needed for ThumbHash and data-URI placeholders. Add your image origin to `img-src` if `/_img` is served from another host.

## Fade

Only measured-mode images fade. An image that has started painting is never hidden:

- The `<img>` gets `opacity: 0` when its `srcset` is set. On `load`, the component waits for `img.decode()` (at most 250 ms) and then fades to `opacity: 1` over `fadeDuration`. A partly downloaded image is never visible, and nothing paints from top to bottom.
- Images that were already complete (from the cache) take the same path. A complete image with no pixels counts as an error.
- Later `srcset` upgrades don't fade again; the browser swaps the pixels in place.
- `fadeDuration={0}` or `prefers-reduced-motion: reduce` swaps instantly after decode.
- On error the placeholder stays and the box gets `data-state="error"`.

Classic-mode images (`priority`, `sizes`, `native`) render at `opacity: 1` from the server with the placeholder behind them. Chrome doesn't count `opacity: 0` paints for LCP, so a fading hero would only register after hydration.

## External images

An image is **owned**, and resized by your backend, when `src` is a path (`/photos/lake.jpg`, `photos/lake.jpg`, with or without a query) or an absolute `http(s)` URL whose host is in the provider's `domains`. Hosts match exactly and case-insensitively; a port in the entry must match too.

```tsx
<LazyEaseProvider domains={['cdn.example.com', 'localhost:3001']}>
```

Everything else is **external**: protocol-relative URLs (`//host/x`), `data:` and `blob:` URLs, other hosts, and every image with `unoptimized`. External images are loaded as is, without a `srcset`. Layout modes, lazy loading, the placeholder and the fade work the same; crops happen only through `object-fit: cover`.

```tsx
<Image src="https://other.site/a.jpg" alt="…" width={400} height={300} />
```

The reference backend only serves files inside its root, so the default loader strips the origin from an owned absolute URL and sends only the path: `domains` means "these hosts serve the same files as my root". Custom loaders get the absolute URL unchanged.

## SSR and no-JS

- Every mode renders deterministic HTML: the box with its layout CSS and placeholder, and an `<img>` with `alt` and its dimensions. Lazy images have no `src` in the HTML. Nothing reads `window` or the DOM during render; format detection, ThumbHash decoding and measuring happen in effects. It works with `renderToString` and the streaming renderers.
- Classic-mode images carry `src` and `srcset` in the HTML and are visible from the first paint. `priority` adds the preload link, which React hoists into `<head>`.
- Measured-mode images render a `<noscript>` with a plain `<img loading="lazy">`: in WebP with the declared crop, the 1× and 2× candidates with `sizes="{width}px"` when `width` is known, otherwise the full ladder with `sizes="100vw"`, and `alt`. Visitors without JavaScript get a correctly sized image.

Development warnings and errors are on unless `process.env.NODE_ENV` is `'production'`; bundlers replace it.

## Next.js App Router

`<Image>` and `<LazyEaseProvider>` are client components (`'use client'`), so Server Components can render them directly. A loader holds functions, and functions can't be passed from a Server Component to a client component. So mount the provider, or any `loader` prop, inside a client file of your own:

```tsx
// app/providers.tsx
'use client'
import { LazyEaseProvider, type ImageLoader } from '@lazy-ease/react'

const loader: ImageLoader = { /* … */ }

export function Providers({ children }: { children: React.ReactNode }) {
  return <LazyEaseProvider loader={loader}>{children}</LazyEaseProvider>
}
```

```tsx
// app/layout.tsx (a Server Component)
import { Providers } from './providers'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

Plain exports such as `createLoader()`, `DEFAULT_WIDTHS` or `formatNumber` also work in Server Components.

## Loaders

A loader turns an image request into a URL and declares what the backend can render. It's the only coupling between the component and the backend.

```ts
interface ImageRequest {
  src: string
  width: number            // always a value of the loader's widths
  aspectRatio?: number     // always a ratio-ladder value; absent when there is no crop
  quality: number          // always one of the loader's qualities
  format: 'avif' | 'webp' | 'jpeg' | 'auto'   // 'auto' only with formats: 'auto'
  version?: string         // the version prop
  focalPoint?: { x: number; y: number }   // whole percent; only with aspectRatio, absent at the center
}

interface ImageLoader {
  url(request: ImageRequest): string
  widths: readonly number[]                         // the width ladder
  ratios?: readonly number[]                        // default: DEFAULT_RATIOS
  qualities: readonly number[]
  formats: readonly ('avif' | 'webp' | 'jpeg')[] | 'auto'
}
```

A plain function `(request) => string` works too. It gets the default ladders, `qualities: [75]` and `formats: ['avif', 'webp', 'jpeg']`.

The default width ladder is `64 128 256 384 640 750 828 1080 1200 1440 1920 2560 3840` (`DEFAULT_WIDTHS`). The backend and the loader must agree on the width ladder, the ratio ladder and the qualities.

### The default loader

`createLoader()` targets `@lazy-ease/server`:

```ts
import { createLoader } from '@lazy-ease/react'

const loader = createLoader({
  baseUrl: '/_img',          // where the image app is mounted
  qualities: [60, 75, 90],   // must match the server's
  params: { tenant: 'acme' } // extra query parameters on every URL
})
```

It also takes `widths` and `ratios`. It emits the canonical URL:

```
{baseUrl}/{src path}?ar={ar}&fmt={fmt}&fx={x}&fy={y}&q={q}&v={version}&w={w}
/_img/my%20photos/caf%C3%A9.jpg?ar=1.333&fmt=webp&fx=30&fy=70&q=75&v=AbC123&w=640
```

- Parameters in alphabetical order, lowercase names, absent ones omitted (`ar` without a crop, `fx` and `fy` at the center, `v` without a version).
- Numbers without trailing zeros or exponent, at most 3 decimals (`1.5`, not `1.50`).
- The source path is the URL path, each segment `encodeURIComponent`-encoded, so the URL ends in the source's extension.

So there is exactly one URL per variant, whatever the CDN's cache key. `@lazy-ease/server` rejects unknown parameters, so `params` are for backends or proxies that strip them first.

`createLoader()` always declares `formats: ['avif', 'webp', 'jpeg']`. To offer fewer formats, override it:

```ts
const webpOnly = { ...createLoader(), formats: ['webp', 'jpeg'] as const }
```

### Third-party loaders

imgix, Cloudinary and Cloudflare Images all negotiate the format through `Accept`, so their loaders declare `formats: 'auto'` and the component skips format detection. imgix (`crop=focalpoint`, `fp-x`, `fp-y`) and Cloudflare (`gravity`) take the focal point in the same sense, as fractions of 1. Cloudinary's `g_xy_center` wants pixels, so it needs the source size.

```ts
import { DEFAULT_WIDTHS, type ImageLoader } from '@lazy-ease/react'

// imgix: w, ar={ar}:1, fit=crop, crop=focalpoint, fp-x, fp-y, fm/auto=format, q
export const imgix: ImageLoader = {
  widths: DEFAULT_WIDTHS,
  qualities: [75],
  formats: 'auto',
  url: ({ src, width, aspectRatio, quality, focalPoint }) =>
    `https://example.imgix.net${src}?auto=format&w=${width}&q=${quality}` +
    (aspectRatio ? `&ar=${aspectRatio}:1&fit=crop` : '') +
    (focalPoint ? `&crop=focalpoint&fp-x=${focalPoint.x / 100}&fp-y=${focalPoint.y / 100}` : ''),
}

// Cloudinary: w_, ar_, c_fill, f_, q_
export const cloudinary: ImageLoader = {
  widths: DEFAULT_WIDTHS,
  qualities: [75],
  formats: 'auto',
  url: ({ src, width, aspectRatio, quality }) => {
    const t = [`w_${width}`, aspectRatio && `ar_${aspectRatio},c_fill`, 'f_auto', `q_${quality}`].filter(Boolean)
    return `https://res.cloudinary.com/demo/image/upload/${t.join(',')}${src}`
  },
}

// Cloudflare Images: width, height=round(w/ar), fit=cover, gravity, format, quality (no ratio parameter)
export const cloudflare: ImageLoader = {
  widths: DEFAULT_WIDTHS,
  qualities: [75],
  formats: 'auto',
  url: ({ src, width, aspectRatio, quality, focalPoint }) => {
    const t = [
      `width=${width}`,
      aspectRatio && `height=${Math.round(width / aspectRatio)},fit=cover`,
      focalPoint && `gravity=${focalPoint.x / 100}x${focalPoint.y / 100}`,
      'format=auto',
      `quality=${quality}`,
    ]
    return `/cdn-cgi/image/${t.filter(Boolean).join(',')}${src}`
  },
}
```

```tsx
<LazyEaseProvider loader={cloudinary}>
```

These assume `src` is a path. If you list `domains`, the loader receives those absolute URLs unchanged and must handle them.

## Server

`createImageApp({ root })` is a Hono app with one route, `GET /{src path}` (`HEAD` too). Mount it at the loader's `baseUrl`. The source path is the URL path after the mount point; the parameters are the query string, exactly as `createLoader()` writes them.

| Param | Required | Rule |
| --- | --- | --- |
| `ar` | no | A ratio-ladder value. Crops to `w × round(w / ar)` around the focal point, by default the center. Without it the image is scaled with its ratio kept. |
| `fmt` | yes | `avif`, `webp` or `jpeg`. There is no `Accept` negotiation. |
| `fx`, `fy` | no | The focal point, whole percent from `0` to `100`. Only both together and only with `ar`; the center (`50`, `50`) is left out. The crop window is the largest one of ratio `ar`, as close to centered on the point as the source edges allow. |
| `q` | no | One of `qualities` (default `[75]`). Absent means the first one. |
| `v` | no | Opaque version token, 1–64 of `A–Z a–z 0–9 - . _ ~`, case kept. Only part of the URL, so a CDN sees a new key; it doesn't change the bytes or the `ETag`. |
| `w` | yes | A width-ladder value. |

**Canonical only.** Parameters must be in alphabetical order, once each, lowercase, with numbers written as the loader writes them (`1.5`, not `1.50`; `640`, not `0640`). Anything else, including unknown parameters, is a `400`. That leaves one URL per variant on CDNs that key on the raw query string.

**Paths.** Sources are read from `root` only. Paths with backslashes, colons (drive letters, URL schemes), a leading `//` (UNC), dot segments or null bytes are a `400`, and so are extensions other than `jpg jpeg png webp avif gif` (SVG, TIFF and animated images aren't sources; GIFs render their first frame). Paths are NFC-normalized, resolved with `realpath` and must stay inside `root`, symlinks included, otherwise `404`.

**Rendering.** Auto-orient from EXIF, crop, convert to sRGB and strip all metadata (EXIF, GPS, XMP, ICC). Images are never upscaled: a source smaller than the target gives a smaller output with the requested ratio.

**Responses.** `Cache-Control: public, max-age=31536000, immutable`, `Content-Type`, `Content-Length`, `X-Content-Type-Options: nosniff` and an `ETag` (hash of the variant and the source mtime); `If-None-Match` gets a `304`.

| Status | When |
| --- | --- |
| `400` | Invalid or non-canonical parameters, or a malformed path |
| `404` | Missing source, or a path outside `root` |
| `413` | Source over `maxFileSize` or `maxInputPixels` |
| `500` | A source that sharp can't decode cleanly (`failOn: 'warning'`) |
| `504` | Render took longer than `timeout` |

| Option | Default | |
| --- | --- | --- |
| `root` | required | Directory the source images are read from. |
| `widths`, `ratios`, `qualities` | the loader defaults | Must match the loader's. |
| `maxFileSize` | 32 MB | Larger sources are a `413`, checked with `stat` before decoding. |
| `maxInputPixels` | 50 MP | Larger sources are a `413`. |
| `timeout` | 10 s | Per render, in ms. The request is answered with a `504` after this long. sharp also receives it (whole seconds, rounded up) to stop decode and resize work, but an AVIF encode already running finishes in the background, so `avifEffort` bounds that part. |
| `concurrency` | half the CPUs, at least 1 | Renders running at once. Concurrent requests for one variant share one render. Each render holds the source file (up to `maxFileSize`) and its decoded pixels (up to `maxInputPixels` × 4 bytes, 200 MB at the defaults). |
| `cacheSize` | 200 | Encoded images kept in an in-memory LRU. `0` turns it off. Production caching belongs in the CDN. |
| `cacheBytes` | 64 MB | Total size of the LRU. The oldest entries go first; `0` turns it off. |
| `avifEffort` | 4 | AVIF encoder effort, `0` (fastest) to `9` (smallest files). |

The package also exports `DEFAULT_WIDTHS`, `DEFAULT_RATIOS`, `DEFAULT_QUALITIES`, `OUTPUT_FORMATS`, and `render(file, params, options)`, the same pipeline the image route runs, for build scripts.

### CDN notes

Put a CDN in front of the image app; its year-long `immutable` responses are meant to be cached there.

- **CloudFront.** The managed `CachingOptimized` policy excludes query strings. Use a cache policy with a query-string allowlist of `ar fmt fx fy q v w`. CloudFront keys on the raw order and case, which the canonical URL takes care of.
- **Cloudflare.** Caches by file extension by default. The URL ends in the source's extension, so that works; otherwise a Cache Rule must mark the path cacheable. Query strings are part of the default key, and the URL is already canonical.
- Both collapse concurrent misses for one key, as the server does.

## Known limitations

- `onLoad` doesn't fire for an image that finished loading before hydration. `data-state` still becomes `loaded`.
- Art direction (a different crop per media query) is planned for v2.
- `rootMargin` inside nested scroll containers, see [Loading](#loading).

## Development

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev        # demo on http://localhost:5173, image server on :3001
pnpm test
pnpm typecheck
pnpm build
pnpm e2e        # Playwright, Chromium and WebKit
```

To check the packages as npm would install them, after `pnpm build`:

```bash
pnpm check:packages   # pnpm pack, publint, attw, tarball contents
pnpm check:next       # Next.js App Router build against the packed @lazy-ease/react
```

`check:packages` leaves the tarballs in `.cache/packs`, and `check:next` installs from there, so run it second. The Next.js check needs network access for npm.

The demo generates its sample images on first start. Drop your own photos into `apps/demo/images` to try them instead. The full design is in [docs/design-spec.md](docs/design-spec.md).

## License

[MIT](LICENSE)
