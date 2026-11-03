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
| [`@lazy-ease/server`](packages/server) | Image resize server (Hono + sharp) and metadata tooling |
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

Mount the app at the loader's `baseUrl` (default `/_img`). It has one route, `GET /{src path}` (`HEAD` too): the source path is the URL path, the parameters are the query string, exactly as `createLoader()` writes them:

```
/_img/my%20photos/caf%C3%A9.jpg?ar=1.333&fmt=webp&q=75&v=AbC123&w=640
```

| Param | Required | Rule |
| --- | --- | --- |
| `ar` | no | A ratio-ladder value (73 values from 0.25 to 4). Crops to `w × round(w / ar)` around the center. Without it the image is scaled with its ratio kept |
| `fmt` | yes | `avif`, `webp` or `jpeg`. There is no `Accept` negotiation |
| `q` | no | One of `qualities` (default `[75]`). Absent means the first one |
| `v` | no | Opaque version token, 1–64 of `A–Z a–z 0–9 - . _ ~`, case kept. Only part of the URL, so a CDN sees a new key |
| `w` | yes | A width-ladder value: 64, 128, 256, 384, 640, 750, 828, 1080, 1200, 1440, 1920, 2560, 3840 |

**Canonical only.** Parameters must be in alphabetical order, once each, lowercase, with numbers written as the loader writes them (`1.5`, not `1.50`; `640`, not `0640`). Anything else, including unknown parameters, is a `400`. That leaves one URL per variant on CDNs that key on the raw query string.

Sources are read from `root` only. Paths with backslashes, colons (drive letters, URL schemes), a leading `//` (UNC), dot segments or null bytes are a `400`; so are extensions other than `jpg jpeg png webp avif gif` (SVG and TIFF are not sources). Paths are NFC-normalized, resolved with `realpath` and must stay inside `root`, symlinks included, otherwise `404`.

The renderer auto-orients from EXIF, crops, converts to sRGB and strips all metadata (EXIF, GPS, XMP, ICC). GIFs render their first frame. Images are never upscaled: a source smaller than the target gives a smaller output with the requested ratio.

Responses carry `Cache-Control: public, max-age=31536000, immutable`, `Content-Type`, `Content-Length`, `X-Content-Type-Options: nosniff` and an `ETag` (hash of the variant and the source mtime); `If-None-Match` gets a `304`.

| Option | Default | Description |
| --- | --- | --- |
| `root` | required | Directory the source images are read from |
| `widths`, `ratios`, `qualities` | the loader defaults | Must match the loader's |
| `maxFileSize` | 32 MB | Larger sources are a `413`, checked before decoding |
| `maxInputPixels` | 50 MP | Larger sources are a `413` |
| `timeout` | 10 s | Per render, in ms. A timeout is a `504` |
| `concurrency` | CPU count | Renders running at once. Concurrent requests for one variant share one render |
| `cacheSize` | 200 | Encoded images kept in an in-memory LRU. Production caching belongs in the CDN |

### Metadata

Metadata is computed by tooling, not by the public server. `computeMetadata(fileOrBuffer)` returns `{ width, height, thumbhash, color }`: the size after EXIF rotation (for `srcWidth`/`srcHeight`), a base64 [ThumbHash](https://evanw.github.io/thumbhash/) (use it as ``placeholder={`thumbhash:${thumbhash}`}``) and the dominant color as `#rrggbb`.

For a demo or local tooling, `createMetaApp({ root })` serves the same object as JSON at `GET /{src path}`. Mount it on its own path so it can't collide with source paths:

```ts
app.route('/_meta', createMetaApp({ root: './images' }))
```

### CDN notes

- **CloudFront.** The managed `CachingOptimized` policy excludes query strings. Use a cache policy with a query-string allowlist of `ar fmt q v w`. CloudFront keys on raw order and case, which the canonical URL takes care of.
- **Cloudflare.** Caches by file extension by default. The URL ends in the source's extension, so that works; otherwise a Cache Rule must mark the path cacheable. Query strings are part of the default key, and the URL is already canonical.
- Both collapse concurrent misses for one key, as the server does.

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
