# lazy-ease

Lazy-loaded, optimized images for React with a smooth fade-in.

> Status: early work in progress. Not published to npm yet, and the API may still change.

```tsx
import { Image } from 'lazy-ease'

<Image
  src="/mountain.jpg"
  aspectRatio={16 / 9}
  placeholder="data:image/svg+xml;base64,…" // inline, from /meta, your CMS or a build step
  alt="Mountain at sunrise"
/>
```

- **Right size, right format.** Give a size or an aspect ratio. The component renders a `<picture>` with one `<source>` per format (AVIF, WebP) plus a JPEG `<img>` fallback, each with a `srcset`. The server returns a cropped, resized variant for each width.
- **Lazy by default.** Images start loading when they come within `rootMargin` of the viewport (IntersectionObserver). You can also switch to the browser's native `loading="lazy"`.
- **Inline placeholder and crossfade.** The placeholder is a data URI (a 1×1 color SVG or a blurred ~16px thumbnail SVG). It is the CSS background on the very first render, with no request. The image stays hidden until it has fully loaded and decoded, then fades in as a whole. It never paints from top to bottom.
- **Self-hostable backend.** It starts as a Node server built on [Hono](https://hono.dev) and [sharp](https://sharp.pixelplumbing.com), with edge functions behind a CDN planned next.
- **Planned: focus points.** Crops will center on a point you choose instead of the middle of the image.

## Packages

| Package | Description |
| --- | --- |
| [`lazy-ease`](packages/react) | The React 19 `<Image>` component |
| [`@lazy-ease/server`](packages/server) | Image resize and placeholder server (Hono + sharp) |
| [`apps/demo`](apps/demo) | Demo page with network throttling |

## `<Image>` props

| Prop | Default | Description |
| --- | --- | --- |
| `src`, `alt` | required | Path of the source image on the server |
| `width`, `height` | | Fixed size in CSS pixels. Without `width` the image fills its container |
| `aspectRatio` | `width / height` | Crops to this ratio and reserves the space, so there is no layout shift |
| `sizes` | `${width}px` or `100vw` | Standard `sizes` attribute |
| `loading` | `lazy` | `lazy` (IntersectionObserver), `native` (`loading="lazy"`) or `eager` |
| `rootMargin` | `400px` | How far outside the viewport `lazy` starts loading |
| `placeholder` | | Inline data URI shown as the background until the image has faded in. See `colorPlaceholder()` and `/meta` |
| `fadeDuration` | `400` | Crossfade in ms. `0` swaps instantly once the image is decoded |
| `formats` | `['webp']` | Formats offered as `<source>` elements, best first. JPEG is always the fallback |
| `priority` | `false` | Eager with `fetchpriority="high"`. Use it for the LCP image |
| `quality` | server default | 1–100 |
| `loader` | `createLoader()` | Builds the URLs, swap it to target another backend or CDN |
| `onVisible` | | Called once when the image starts loading |

Set defaults for a subtree with `<LazyEaseProvider loader={…} formats={['avif', 'webp']} rootMargin="800px">`.

`colorPlaceholder('#5b6c8f')` builds the 1×1 SVG data URI in the browser if you already store a dominant color.

## Server

```ts
import { serve } from '@hono/node-server'
import { createImageApp } from '@lazy-ease/server'
import { Hono } from 'hono'

const app = new Hono()
app.route('/_img', createImageApp({ root: './images' }))
serve({ fetch: app.fetch, port: 3001 })
```

| Route | Description |
| --- | --- |
| `GET /image?src&w&h&q&fmt` | Resized image. `w` snaps to an allowed width, `h` crops (cover). The component always sends an explicit `fmt`. `fmt=auto` negotiates via `Accept` |
| `GET /meta?src&ar` | `{ width, height, placeholder }` with the placeholder as a data URI, to inline at build time, during SSR or in your CMS |
| `GET /placeholder?src&ar&mode` | The raw placeholder SVG, `mode=blur` (default) or `color` (1×1) |

`createPlaceholder(file, { mode })` and `svgToDataUri(svg)` are exported for build scripts.

Sources are only read from `root`. Remote URLs and paths outside `root` are rejected. Images are never upscaled.

## Development

Requires Node 22+ and pnpm.

```bash
pnpm install
pnpm dev        # demo on http://localhost:5173, image server on :3001
pnpm test
pnpm typecheck
pnpm build
```

The demo generates its sample images on first start. Drop your own photos into `apps/demo/images` to try them instead.

## License

[MIT](LICENSE)
