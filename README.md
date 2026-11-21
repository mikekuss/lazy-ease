# lazy-ease

Lazy-loaded, right-sized images with an inline placeholder and a fade, for React 19 and for server-rendered HTML, with a reference image backend.

**[Live demo](https://mikekuss.github.io/lazy-ease/)**. The hosted demo serves pre-rendered variants through a static loader, so arbitrary measured fill ratios aren't available there; run it locally (see [Development](#development)) for the full behavior.

```tsx
import { Image } from '@lazy-ease/react'

<Image src="/photos/lake.jpg" alt="Lake at dawn" width={320} height={240} />
```

What it does:

1. **Less data.** Every image is delivered at the size it is rendered at (× device pixel ratio, capped at 2), in WebP or, with the opt-in detection, AVIF, cropped by the server or the browser.
2. **No layout shift.** Fixed sizes, aspect ratios, fill boxes and known source dimensions reserve the space before the image arrives.
3. **No unnecessary loads.** Deferred images aren't requested until they come near the viewport. Measured images hidden with `display: none` are never requested.
4. **A placeholder on first paint.** A color, a data URI or a [ThumbHash](https://evanw.github.io/thumbhash/) as an inline style in the server HTML, with no extra request.
5. **One contract.** React, plain HTML templates and other backends share the same URL format, ladders and [conformance fixtures](packages/testing).

| Package | |
| --- | --- |
| [`@lazy-ease/react`](packages/react) | The `<Image>` component and `<LazyEaseProvider>`. Needs React 19. |
| [`@lazy-ease/core`](packages/core) | The framework-free part: ladders, the reference loader, candidate selection, focal crop geometry and the DOM controller. No dependencies. |
| [`@lazy-ease/vanilla`](packages/vanilla) | lazy-ease for server-rendered HTML: `enhance()`, the stylesheet and a self-starting script. |
| [`@lazy-ease/server`](packages/server) | The reference image backend (Node, [Hono](https://hono.dev) and [sharp](https://sharp.pixelplumbing.com)) and metadata tooling for upload or build scripts. |
| [`@lazy-ease/testing`](packages/testing) | Portable conformance fixtures as JSON, for loaders, templates and backends in any language. |
| [`apps/demo`](apps/demo) | Demo with network throttling. Not published. |

All five packages are released together under one version. More reading: [image recipes](docs/image-recipes.md) for React, vanilla and PHP, the [backend guide](docs/backend.md), the [design specification](docs/design-spec.md) and the [migration guide from 0.2](docs/migrating-from-0.2.md).

## Install

```bash
npm install @lazy-ease/react                          # React 19 apps
npm install @lazy-ease/core                           # framework-free code, ThumbHash decoder
npm install @lazy-ease/vanilla @lazy-ease/core        # server-rendered HTML
npm install @lazy-ease/server hono @hono/node-server  # the image backend, Node 22+
npm install --save-dev @lazy-ease/testing             # conformance fixtures
```

`@lazy-ease/react` has `react` and `react-dom` 19 as peer dependencies. You can also bring your own backend through a [custom loader](#loaders).

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

Then render images. The provider is optional; it sets defaults for its subtree:

```tsx
import { Image, LazyEaseProvider } from '@lazy-ease/react'

export function App() {
  return (
    <LazyEaseProvider rootMargin="800px">
      {/* LCP image: real sources in the server HTML, preloaded with high priority */}
      <div style={{ position: 'relative', aspectRatio: 2 }}>
        <Image src="/hero.jpg" alt="Harbor at dusk" fill aspectRatio={2} sizes="100vw" priority srcWidth={3000} srcHeight={2000} />
      </div>

      <Image src="/photos/lake.jpg" alt="Lake at dawn" width={320} height={240} srcWidth={2400} srcHeight={1800} />
      <Image src="/photos/fern.jpg" alt="Fern" aspectRatio={16 / 9} srcWidth={1600} srcHeight={900} placeholder="#5b6c8f" />
    </LazyEaseProvider>
  )
}
```

`/photos/lake.jpg` is read from `./images/photos/lake.jpg`. `srcWidth` and `srcHeight` are the sources' oriented sizes, from [metadata](#placeholders); with them each image gets a `srcset` labeled with the widths the server actually encodes. If the page and the image server have different origins, proxy `/_img` or pass `createLoader({ baseUrl: 'https://img.example.com/_img' })` as the provider's `loader`.

## `<Image>` props

| Prop | Type | Default | Behavior |
| --- | --- | --- | --- |
| `src` | `string` | required | Path or URL of the source image. A new `src` starts over with its placeholder. |
| `alt` | `string` | required | Passed to `<img>`. |
| `width` | `number` | | Rendered width in CSS px. |
| `height` | `number` | | Rendered height in CSS px. Only valid together with `width`. |
| `aspectRatio` | `number` | | Box ratio in ratio mode. In fill mode, the crop ratio sent to the backend. |
| `fill` | `boolean` | `false` | The box fills its positioned parent. |
| `crop` | `'server' \| 'browser'` | see [Layout modes](#layout-modes) | Who crops: the backend at a ladder ratio, or the browser with `object-fit: cover` on the uncropped source. `'browser'` needs `srcWidth` and `srcHeight`. |
| `sizes` | `string` | measured | Prepares the candidates for this slot at render time instead of measuring. See [Loading modes](#loading-modes). |
| `srcWidth`, `srcHeight` | `number` | | Oriented size of the source, from `computeMetadata`. Widths above `srcWidth` aren't offered, a candidate list needs both, and an intrinsic image reserves their ratio. |
| `focalPoint` | `{ x, y }` | center | The point to keep in view when the image is cropped, in percent of the source (0–100). See [Focal point](#focal-point). |
| `version` | `string` | | The source's revision, sent as `v`. |
| `token` | `string` | | A crop token from the backend, sent as `token`. |
| `quality` | `number` | provider (`75`) | Snapped to the nearest quality the loader allows. |
| `loading` | `'lazy' \| 'eager' \| 'native'` | provider (`'lazy'`) | See [Loading modes](#loading-modes). `native` requires `width` or `sizes`. |
| `rootMargin` | `string` | provider (`'400px'`) | Preload distance for `lazy`. |
| `priority` | `boolean` | `false` | Native sources, eager, `fetchpriority="high"`, a preload and no fade. Requires `width` or `sizes`. For the LCP image only. |
| `placeholder` | `string` | provider (`'#e5e7eb'`) | A CSS color, a data URI, `thumbhash:<base64>` or `'none'`. See [Placeholders](#placeholders). |
| `fadeDuration` | `number` | provider (`400`) | Fade in ms after load and decode. `0` swaps directly. Native images never fade. |
| `reveal` | `Reveal` | provider (none) | Keyframes for the fade instead of the crossfade. `focusReveal` from `@lazy-ease/core` starts the image as blurred as a ThumbHash placeholder and sharpens it. |
| `unoptimized` | `boolean` | `false` | Loads `src` as is, without the loader. |
| `loader` | `ImageLoader` or function | provider | Per-image loader. Ignored on images that load directly, with a development warning. |
| `sources` | `ImageSource[]` | | Art-direction sources in a `<picture>`, each with `media`, `src` and optional `aspectRatio`, `srcWidth`, `srcHeight`, `focalPoint`, `sizes`, `token` and `version`. |
| `noScript` | `boolean` | `false` | Adds a native `<img>` in `<noscript>` for visitors without JavaScript. Deferred images only. |
| `onStateChange` | `(state, img) => void` | | Every state change: `idle`, `loading`, `loaded` (once per source, also for an image that loaded before hydration) or `error`. |
| `onLoad` | | | The React event of the first real load of the displayed source, called once. An image adopted after hydration gets no event; use `onStateChange`. Resolution upgrades aren't reported. |
| `ref` | | | Forwarded to the `<img>`. |
| `className`, `style` | | | Applied to the `<img>`. |
| `wrapperClassName`, `wrapperStyle` | | | Applied to the box, the `<span>` around the `<img>`. Passing either keeps the box. With `noScript`, the box is a grid that stacks the fallback on the placeholder; keep its `display` a grid (`grid` or `inline-grid`). |

Any other `<img>` attribute (`crossOrigin`, `referrerPolicy`, `onError`, …) is passed through. `decoding` defaults to `"async"`.

The box is a `<span data-le data-le-auto="off">`. It is rendered only where something needs it: `fill`, a fade, browser focal positioning or the wrapper props. Without it, the `<img>` carries the marker, the layout styles and the placeholder. The marked element carries `data-state="idle" | "loading" | "loaded" | "error"` for styling and tests. `data-le-auto="off"` keeps it out of the [vanilla](packages/vanilla) script's scan.

### Layout modes

The mode follows from the props, in this order:

| | Mode | Props | Box | Server crop |
| --- | --- | --- | --- | --- |
| 1 | **fill** | `fill` | `position: absolute; inset: 0` | `aspectRatio` if given. Without it: browser crop when `srcWidth` and `srcHeight` are known, otherwise the measured box ratio. |
| 2 | **fixed** | `width` and `height` | `width: {w}px; max-width: 100%; aspect-ratio: {w} / {h}` | `w / h` |
| 3 | **ratio** | `aspectRatio`, with or without `width` | `width: {w}px` or `100%`; `aspect-ratio: {r}` | `r` |
| 4 | **intrinsic** | only `width`, or nothing | `width: {w}px` or `100%`; `aspect-ratio` from `srcWidth` and `srcHeight` | none |

In fill, fixed and ratio mode the `<img>` covers the box with `object-fit: cover`. `fill` needs a positioned parent; the component doesn't add one. `crop="browser"` asks for the uncropped source at the cover width, `max(box width, box height × source ratio)`, and lets `object-fit` crop; `crop="server"` keeps the server crop. A prepared or native fill image without `aspectRatio` has nothing to measure, so it is never cropped on the server. An intrinsic image without `srcWidth` and `srcHeight` can't reserve a height and shifts the layout when it loads; a development warning says so.

Every crop ratio is snapped to a shared ratio ladder (73 values from 0.25 to 4, at most 2.2 % apart, with `4/3`, `3/2`, `16/9`, `21/9` and their inverses on it).

With `sources`, the box ratio is `var(--le-ar, …)`, so CSS can change it at a breakpoint:

```tsx
import { Image } from '@lazy-ease/react'

const wide = { media: '(min-width: 800px)', src: '/lake.jpg', aspectRatio: 2, srcWidth: 2400, srcHeight: 1600, sizes: '50vw' }

// CSS: .card { --le-ar: 4/3 }  @media (min-width: 800px) { .card { --le-ar: 2 } }
export function Card() {
  return (
    <div className="card">
      <Image src="/lake.jpg" alt="Lake" aspectRatio={4 / 3} srcWidth={2400} srcHeight={1600} sources={[wide]} sizes="100vw" />
    </div>
  )
}
```

These combinations throw in development: `height` without `width`; `fill` with `width` or `height`; `width`, `height` and `aspectRatio` together; `crop="browser"` without `srcWidth` and `srcHeight`; `priority` or `loading="native"` without `width` or `sizes`.

### Provider

`<LazyEaseProvider>` sets defaults for its subtree. Nested providers merge with their parent. `useLazyEaseConfig()` returns the merged values.

| Option | Default | |
| --- | --- | --- |
| `loader` | `createLoader()` | The loader object or function (see [Loaders](#loaders)). |
| `domains` | `[]` | Extra hosts treated as owned, besides relative paths (see [External images](#external-images)). |
| `quality` | `75` | |
| `loading` | `'lazy'` | |
| `root` | the viewport | The scrolling element deferred images are observed against. |
| `rootMargin` | `'400px'` | |
| `dwellTime` | `0` | How long, in ms, an image must stay in the preload zone before it loads. Leaving earlier requests nothing, so fast flings through a long gallery stay cheap. |
| `placeholder` | `'#e5e7eb'` | Used without a `placeholder` prop or for an invalid one. |
| `fadeDuration` | `400` | |
| `reveal` | none | `focusReveal` sharpens every deferred image from a placeholder-like blur during its fade. |
| `thumbhash` | none | The decoder for `thumbhash:` placeholders, `thumbhashDecoder(thumbhash)` from `@lazy-ease/core/thumbhash`. See [Placeholders](#placeholders). |
| `thumbhashSsr` | `'color'` | `'image'` puts decoded ThumbHash images in the server HTML instead of only their average color. |
| `detectFormat` | none | Picks the format of measured images: `detectAvif` from `@lazy-ease/core` requests AVIF where the browser decodes it. Without it they take the best declared format other than AVIF, WebP first; a loader that declares only AVIF gets AVIF. Pass a stable function: a new one reattaches every image. See [Loading modes](#loading-modes). |

## Loading modes

Where the URLs come from and when the image shows are separate choices:

| Props | Server HTML | After hydration |
| --- | --- | --- |
| none (measured) | Placeholder and an inert inline GIF as `src` | Near the viewport, the controller measures the box, asks the loader for candidates up to twice its width, and fades the image in. |
| `sizes` (prepared) | Placeholder and inert `src`; the candidates are built at render time | Near the viewport, the controller copies the prepared candidates and fades the image in. Nothing is measured. |
| `loading="native"` | The real `src`, `srcset` and `sizes` with `loading="lazy"` | The browser loads it; the controller only reports its state and removes the placeholder. |
| `priority` | The real sources, `fetchpriority="high"` and a preload link | As native, loaded eagerly. |

`loading="lazy"` (the default) activates a deferred image when it comes within `rootMargin` of the root, through one shared `IntersectionObserver` per root and margin. `loading="eager"` activates it right after hydration, still with the fade.

**Measured images** grow their candidates when the box grows (after a 200 ms trailing debounce) and never shrink them, so resizing only downloads anything when a larger ladder step is needed. The browser keeps the displayed image during an upgrade. The format is the best one the loader declares other than AVIF, WebP first. AVIF detection is opt-in, so apps that don't use it don't ship it: with `detectFormat={detectAvif}` (from `@lazy-ease/core`) on the provider, the format is the best one the browser decodes among the loader's `formats`; AVIF is probed once, when the first measured image activates, and WebP is taken if that takes longer than 200 ms. A loader that declares only AVIF gets AVIF, without a detector and without a warning. A development build warns once when the loader declares AVIF besides other formats and no detector is set. In development, the component warns when a deferred image is already in the first viewport when it mounts.

**Prepared and native candidates** are built before anything is known about the browser, so they use WebP (or JPEG, if the loader has no WebP). A known `width` gives the 1× and 2× widths, snapped to the ladder; without `width`, `sizes` offers the full ladder. `sizes` defaults to `{width}px` or `100vw`.

**Candidate lists need source dimensions.** Each candidate is labeled with the width the backend actually encodes, which is known only with both `srcWidth` and `srcHeight`; candidates that encode the same pixels are merged. Without them, an image gets a single URL for its largest candidate. Pass both from your metadata.

`priority` emits a `<link rel="preload" as="image" imagesrcset imagesizes fetchpriority="high">` through React's `preload()`, built from the same strings as the `<img>`, with its `crossOrigin` and `referrerPolicy`, so the browser fetches the image once. With `sources`, only the first source is preloaded, under its media query. Use `priority` for the LCP image only and `loading="native"` for other images in the first viewport: deferred images wait for hydration, and the browser's preload scanner never sees them.

**Fade.** A deferred image fades in over `fadeDuration` after it has loaded and decoded, so a half-downloaded image never paints. If decoding takes longer than 250 ms the image is shown anyway. `fadeDuration={0}` or `prefers-reduced-motion: reduce` swaps directly. Later upgrades don't fade again. With `reveal={focusReveal}` (from `@lazy-ease/core`) the image starts blurred by 8 % of the box's longer edge, as much as a ThumbHash placeholder, is opaque after 45 % of the fade and sharpens until its end, so the placeholder seems to come into focus. A mask of the image's box keeps the blur inside it; the image's own `clip-path` still applies, a `mask` of its own is replaced while the reveal runs. The box size comes from a ResizeObserver, so the reveal reads no layout. A reveal is a function from that edge to keyframes, so a bundle that doesn't import `focusReveal` doesn't carry it; one that throws gets the plain fade, and its error is reported. Another reveal function takes effect at the next fade, without a re-attach. The placeholder stays under the image until the fade ends and is removed then, so transparent images don't show it. A ThumbHash with alpha stands for a transparent image: its placeholder fades out during the fade instead, so the image crossfades. A failed first load removes the placeholder, keeps the reserved area and sets `data-state="error"`, so the alt text or the browser's broken-image presentation shows.

**Nested scroll containers.** Inside a carousel or an `overflow: auto` panel, the container clips before `rootMargin` applies along its scroll axis. The observer also passes the margin as `scrollMargin`, which Chromium supports; elsewhere such images load when they become visible. Set the provider's `root` to the container to observe against it.

## Placeholders

The placeholder is an inline style in the server HTML, painted on the first frame with no request.

| `placeholder` | Rendered as |
| --- | --- |
| A CSS color: `#5b6c8f`, `rgb(…)`, `hsl(…)`, a named color | `background-color` |
| A data URI: `data:image/…` | `background-image`, `background-size: cover` |
| `thumbhash:<base64>` | The average color, then the decoded image (needs the provider's `thumbhash` decoder) |
| `'none'` | Nothing |

Without the prop, the provider's color is used, for external images too. An invalid value falls back to it with a development warning.

**ThumbHash.** Decoding is opt-in, so apps that don't use it don't ship it. Install `@lazy-ease/core` and the `thumbhash` package, and register the decoder on the provider:

```tsx
import * as thumbhash from 'thumbhash'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import { Image, LazyEaseProvider } from '@lazy-ease/react'

const decoder = thumbhashDecoder(thumbhash)

export function Gallery({ hash }: { hash: string }) {
  return (
    <LazyEaseProvider thumbhash={decoder}>
      <Image src="/photos/lake.jpg" alt="Lake at dawn" aspectRatio={4 / 3} placeholder={`thumbhash:${hash}`} />
    </LazyEaseProvider>
  )
}
```

The decoded image is a small PNG that the browser would upscale with visible steps, so the decoder draws it in an SVG with a Gaussian blur of 8 % of its longer edge: `thumbhashDecoder(thumbhash, { blur: 12 })` changes it, `blur: 0` paints the PNG as is. A ThumbHash with alpha keeps its transparency, paints no average color under its image and fades out while the image fades in, so a transparent image crossfades. Every other placeholder (colors, data URIs, opaque ThumbHashes, the box's own CSS) stays under the image until the fade ends, also under the edges `focusReveal` blurs. A decoded ThumbHash is about 6 KB per image, the PNG in its blurring SVG. So the server HTML gets only the hash's average color, and a deferred image swaps in the decoded image when it activates, so off-screen images never decode. `priority` images, and every image under `thumbhashSsr: 'image'`, get the decoded image in the server HTML. Other native images show only the color. Without a decoder, a `thumbhash:` placeholder falls back to the provider's default with a development warning.

**Metadata.** Compute sizes, placeholders and revisions once, at upload or build time, and store them with the image:

```ts
import { computeMetadata } from '@lazy-ease/server'

const { width, height, thumbhash, color, revision } = await computeMetadata('./images/photos/lake.jpg')
// width, height: size after EXIF rotation, for srcWidth and srcHeight
// thumbhash: base64, for placeholder={`thumbhash:${thumbhash}`}
// color: dominant color as #rrggbb, usable as placeholder directly
// revision: the content revision the server expects as v, for version
```

```tsx
<Image
  src={photo.src}
  alt={photo.alt}
  fill
  srcWidth={photo.width}
  srcHeight={photo.height}
  version={photo.revision}
  placeholder={`thumbhash:${photo.thumbhash}`}
/>
```

`computeMetadata` also takes a `Buffer`. For local tooling, `createMetaApp({ root })` serves the same object as JSON at `GET /{src path}`. Mount it on its own path, never on the public image route.

### Content Security Policy

Layout and placeholders are inline `style` attributes, and the inert `src` of a deferred image, data-URI placeholders and decoded ThumbHash placeholders are `data:` URIs. With a strict CSP, allow both:

```
style-src-attr 'unsafe-inline';
img-src 'self' data:;
```

`style-src-attr 'unsafe-inline'` (CSP level 3) covers style attributes only, not `<style>` elements; on browsers without `style-src-attr`, `style-src` applies. Instead of `'unsafe-inline'`, you can allow the attributes with hashes (`'unsafe-hashes'` plus a `'sha256-…'` per distinct style). Styles the controller sets after hydration go through the CSSOM and need no allowance. Add your image origin to `img-src` if `/_img` is served from another host.

## Focal point

`focalPoint={{ x, y }}` keeps a point of the source in view when the image is cropped. `x` and `y` are percent of the source's width and height (0–100), rounded to whole percent. The point ends up as close to the box center as the image edges allow, the way imgix's `fp-x`/`fp-y` and Cloudflare's `gravity` work.

```tsx
import { Image } from '@lazy-ease/react'

<div style={{ position: 'relative', height: 200 }}>
  <Image src="/banner.jpg" alt="Coastline" fill sizes="100vw" priority srcWidth={1600} srcHeight={500} focalPoint={{ x: 70, y: 60 }} />
</div>
```

- **On the server.** When the request has a crop ratio, `createLoader()` writes the point as `fx` and `fy`, and the server cuts the largest window of that ratio around it. The center is never sent. The reference server admits a focal crop only when the source's policy records that focus, lists the crop, or the URL carries a crop token (see [`@lazy-ease/server`](packages/server#source-policy)).
- **In the browser.** The box becomes a size container and the `<img>` gets an `object-position` in container units, right in the server HTML and after every resize. It places what the server doesn't crop: browser crops, external images and the rest the ratio ladder leaves over. It needs `srcWidth` and `srcHeight`; without them an uncropped image falls back to `object-position: x% y%`.
- Intrinsic images are never cropped, so `focalPoint` does nothing there.

A custom loader whose backend crops must keep `focalPoint` as close to the crop's center as the source edges allow, or the browser's positioning won't match.

## External images

An image is **owned**, and resized by your backend, when `src` is a path (`/photos/lake.jpg`, `photos/lake.jpg`) or an absolute `http(s)` URL whose host is in the provider's `domains`. Hosts match exactly and case-insensitively; a port in the entry must match too.

```tsx
import { Image, LazyEaseProvider } from '@lazy-ease/react'

<LazyEaseProvider domains={['cdn.example.com', 'localhost:3001']}>
  {/* owned: resized by your backend */}
  <Image src="https://cdn.example.com/photos/lake.jpg" alt="Lake at dawn" width={320} height={240} />
  {/* external: loaded as is */}
  <Image src="https://other.example/a.jpg" alt="Fern" width={400} height={300} />
</LazyEaseProvider>
```

Everything else loads as is, without a `srcset`: protocol-relative URLs (`//host/x`), `data:` and `blob:` URLs, other hosts, images with `unoptimized`, and SVG and GIF sources (by extension or data MIME type), so vectors and animations stay intact. Layout, lazy loading, the placeholder and the fade work the same; crops happen only through `object-fit: cover`.

The default loader sends only the path of an owned absolute URL: `domains` means "these hosts serve the same files as my root". Custom loaders get the absolute URL unchanged.

## SSR and no-JS

- Every mode renders deterministic HTML. Nothing reads `window` or the DOM during render; measuring, format detection and ThumbHash decoding happen after hydration. It works with `renderToString` and the streaming renderers.
- Deferred images render a valid `<img>` with an inert inline GIF as `src`, so it shows no alt text and no broken image before activation. Native and `priority` images render their real sources.
- Without JavaScript, or with a bundle that fails to load, a deferred image keeps its placeholder. `noScript` adds a native `<img loading="lazy">` in `<noscript>` for visitors with scripting disabled; native images need none.
- Development checks run wherever the bundler replaces `process.env.NODE_ENV` with anything but `"production"`, also without a `process` global (Vite). Production builds drop them.

## Next.js App Router

`<Image>` and `<LazyEaseProvider>` are client components (`'use client'`), so Server Components can render them directly. A loader and a ThumbHash decoder hold functions, and functions can't be passed from a Server Component to a client component. So mount the provider in a client file of your own:

```tsx
// app/providers.tsx
'use client'
import type { ReactNode } from 'react'
import * as thumbhash from 'thumbhash'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import { LazyEaseProvider, createLoader } from '@lazy-ease/react'

const loader = createLoader({ baseUrl: 'https://img.example.com/_img' })
const decoder = thumbhashDecoder(thumbhash)

export function Providers({ children }: { children: ReactNode }) {
  return (
    <LazyEaseProvider loader={loader} thumbhash={decoder}>
      {children}
    </LazyEaseProvider>
  )
}
```

```tsx
// app/layout.tsx
import type { ReactNode } from 'react'
import { Providers } from './providers'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

The same goes for a `loader` prop on an `<Image>` in a Server Component. Plain exports such as `createLoader()`, `DEFAULT_WIDTHS` or `formatNumber`, and everything in `@lazy-ease/core`, also work in Server Components.

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
  token?: string           // the token prop
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

The default width ladder is `64 128 256 384 640 750 828 1080 1200 1440 1920 2560 3840` (`DEFAULT_WIDTHS`). The backend and the loader must agree on the width ladder, the ratio ladder, the qualities and the formats.

### The default loader

`createLoader()` targets `@lazy-ease/server`:

```ts
import { createLoader } from '@lazy-ease/react'

const loader = createLoader({
  baseUrl: '/_img',             // where the image app is mounted
  qualities: [60, 75, 90],      // must match the server's
  formats: ['webp', 'jpeg'],    // what the server encodes, best first
})
```

It also takes `widths`, `ratios` and `params` (extra query parameters for backends or proxies that strip them; `@lazy-ease/server` rejects unknown parameters). It writes the canonical URL:

```
{baseUrl}/{src path}?ar={ar}&fmt={fmt}&fx={x}&fy={y}&q={q}&token={token}&v={version}&w={w}
/_img/my%20photos/caf%C3%A9.jpg?ar=1.333&fmt=webp&fx=30&fy=70&q=75&v=AbC123&w=640
```

- Parameters in alphabetical order, lowercase names, absent ones omitted (`ar` without a crop, `fx` and `fy` at the center, `token` and `v` when not given). `q` is always written.
- Numbers without trailing zeros or exponent, at most 3 decimals (`1.5`, not `1.50`).
- The source path is the URL path, each segment NFC-normalized and `encodeURIComponent`-encoded, so the URL ends in the source's extension. A source with a scheme other than `http` or `https` throws a `RangeError`.

So there is exactly one URL per variant, whatever the CDN's cache key. With one format, or without AVIF among them, the browser needs no format probe.

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

These assume `src` is a path. If you list `domains`, the loader receives those absolute URLs unchanged and must handle them.

## Without React

[`@lazy-ease/vanilla`](packages/vanilla) brings the same placeholder, lazy loading and fade to HTML rendered by PHP, a static site generator or any other template. The template renders the box, the placeholder and the image with `data-le-*` attributes; `lazy-ease.min.js` enhances the areas marked `data-le-auto`, or `enhance(le, root)` does it from a bundle. [`@lazy-ease/core`](packages/core) has the controller (`createLazyEase(config).attach(img, options)`) for other frameworks, and the pure functions (`createLoader`, `candidateSet`, `imageSet`, `outputSize`, …) for templates and build scripts in Node. The [recipes](docs/image-recipes.md) show each case in React, vanilla and PHP.

## Server

`createImageApp(options)` is a Hono app for `GET` and `HEAD /{src path}?ar&fmt&fx&fy&q&token&v&w`. Mount it at the loader's `baseUrl`. It accepts only the canonical URLs the loader writes, crops around the focal point, auto-orients, converts to sRGB, strips metadata and never upscales. GIF and SVG originals requested without a transform are passed through unchanged.

```ts
import { createImageApp, diskStorage } from '@lazy-ease/server'
import { Hono } from 'hono'

const storage = diskStorage({ dir: '/var/cache/lazy-ease', maxBytes: 4 * 1024 ** 3 })
const app = new Hono()
app.route('/_img', createImageApp({
  root: './images',
  formats: ['webp', 'jpeg'],
  storage,
  policy: async ({ path }) => (path.startsWith('/drafts/') ? undefined : {}), // undefined is a 404
}))
process.on('SIGTERM', () => storage.close().then(() => process.exit(0)))
```

Each request is admitted before any cache lookup: a canonical query with `w`, `fmt` and `q` from the configured ladders, a safe source path inside `root`, a source `policy` (current `revision`, recorded `focalPoint`, the `crops` admitted without a token, `private`), `authorize` for private sources, then the revision named by `v` and the crop. A `v` other than the source's current revision is a `404`. Optional crop tokens, signed with `signCropToken()` and the `keys` option, admit crops the policy doesn't list. Encoded variants are kept in a bounded `diskStorage()` (the default, in `.cache/lazy-ease`) or `memoryStorage()`.

| Option | Default | |
| --- | --- | --- |
| `root` | required | Directory the source images are read from. |
| `widths`, `ratios`, `qualities`, `formats` | the loader defaults | Must match the loader's. Checked at construction: widths positive integers and ratios positive, both ascending, qualities integers from 1 to 100. |
| `tenant` | `default` | Namespace for variant identity and crop tokens. |
| `sourceNamespace` | the real path of `root` | Part of the variant identity. By default, apps with different roots never share a stored variant. Hosts that share one storage and serve the same sources set the same value, whatever their mount paths; different sources need different values. |
| `policy`, `authorize`, `keys` | public, default revision and crops | Admission; see the [server README](packages/server#admission). |
| `originals` | `['gif', 'svg']` | Types passed through unchanged. |
| `maxFileSize`, `maxInputPixels` | 32 MB, 50 MP | Larger sources are a `413`. |
| `timeout` | 10 s | Response deadline from admission, in ms, covering policy, authorization, storage and rendering; then a `504`. |
| `concurrency`, `maxPending` | half the CPUs, 4 × `concurrency` | Renders running and waiting; beyond that a `503`. |
| `storage` | `diskStorage()` | Where encoded variants are kept. |
| `avifEffort` | 4 | AVIF encoder effort, `0` to `9`. |

Caching follows the revision: `public, max-age=31536000, immutable` with the current `v`, `public, no-cache` without `v`, `private, no-cache` for private sources and `no-store` on errors, with an `ETag` and `304`. The [server README](packages/server) has the admission order, policies, crop tokens, storage and sizing; the [backend guide](docs/backend.md) describes the contract for other backends.

The package also exports `computeMetadata`, `createMetaApp`, `render` for build scripts, `signCropToken`, `verifyCropToken`, `cropTokenMessage`, `DEFAULT_WIDTHS`, `DEFAULT_RATIOS`, `DEFAULT_QUALITIES`, `OUTPUT_FORMATS` and `TRANSFORM_PROFILE`.

### CDN notes

Put a CDN in front of the image app; its year-long `immutable` responses are meant to be cached there.

- **CloudFront.** The managed `CachingOptimized` policy excludes query strings. Use a cache policy with a query-string allowlist of `ar fmt fx fy q token v w`. CloudFront keys on the raw order and case, which the canonical URL takes care of.
- **Cloudflare.** Caches by file extension by default. The URL ends in the source's extension, so that works; otherwise a Cache Rule must mark the path cacheable. Query strings are part of the default key, and the URL is already canonical.
- Private sources need the viewer check before every CDN hit, and a CDN that drops `token` from its key must verify it first.

## Development

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev        # demo on http://localhost:5173, image server on :3001
pnpm test
pnpm typecheck
pnpm build
pnpm e2e        # Playwright, Chromium, WebKit and Firefox
```

After `pnpm build`:

```bash
pnpm check:packages   # pnpm pack, publint, attw, tarball contents
pnpm check:next       # Next.js App Router build against the packed packages
pnpm check:sizes      # bundle sizes against their budgets
pnpm check:examples   # typechecks the README examples
pnpm check:fixtures   # recomputes the conformance fixtures in Python
```

`check:packages` leaves the tarballs in `.cache/packs`, and `check:next` installs from there, so run it second. The Next.js check needs network access for npm.

The demo generates its sample images on first start. Drop your own photos into `apps/demo/images` to try them instead. It has three routes: `/fade/` (the hero behind a placeholder, with throttling and a late script start), `/lcp/` (the same hero as native markup in the first HTML, no script) and `/recipes/` (every case of [docs/image-recipes.md](docs/image-recipes.md), with sign-in, a denied crop and the server's storage on the live server). `pnpm --filter demo build:static` builds the GitHub Pages version into `apps/demo/dist`; `pnpm --filter demo build:live` and `pnpm --filter demo start` build and serve the live version on :3001.

Releases are published from GitHub Actions when a version tag is pushed; the steps are in [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE)
