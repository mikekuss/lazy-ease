# @lazy-ease/server

The reference image backend for [`@lazy-ease/react`](https://www.npmjs.com/package/@lazy-ease/react): a [Hono](https://hono.dev) app that resizes, crops and encodes images with [sharp](https://sharp.pixelplumbing.com), plus metadata tooling for upload or build scripts. Node 22+.

```bash
npm install @lazy-ease/server hono @hono/node-server
```

```ts
import { serve } from '@hono/node-server'
import { createImageApp } from '@lazy-ease/server'
import { Hono } from 'hono'

const app = new Hono()
app.route('/_img', createImageApp({ root: './images' }))
serve({ fetch: app.fetch, port: 3001 })
```

It serves `GET /_img/{src path}?ar&fmt&q&v&w`, accepts only the canonical URLs `@lazy-ease/react`'s default loader writes (anything else is a `400`), never upscales, strips metadata and sends year-long `immutable` caching headers for a CDN.

```ts
import { computeMetadata } from '@lazy-ease/server'

const { width, height, thumbhash, color } = await computeMetadata('./images/photos/lake.jpg')
```

## Options

| Option | Default | |
| --- | --- | --- |
| `root` | required | Directory the source images are read from. |
| `widths`, `ratios`, `qualities` | the loader defaults | Must match the loader's. |
| `maxFileSize` | 32 MB | Larger sources are a `413`, checked before decoding. |
| `maxInputPixels` | 50 MP | Larger sources are a `413`. |
| `timeout` | 10 s | Per render, in ms. The request is answered with a `504` after this long. sharp also receives it (whole seconds, rounded up) to stop decode and resize work, but an AVIF encode already running finishes in the background, so `avifEffort` bounds that part. |
| `concurrency` | half the CPUs, at least 1 | Renders running at once; libvips adds its own threads per render. |
| `cacheSize` | 200 | Encoded images kept in the in-memory LRU. `0` turns it off. |
| `cacheBytes` | 64 MB | Total size of the LRU; the oldest entries go first. `0` turns it off. |
| `avifEffort` | 4 | AVIF encoder effort, `0` (fastest) to `9` (smallest files). |

**Memory.** Each running render holds the source file (up to `maxFileSize`) and its decoded pixels (up to `maxInputPixels` × 4 bytes, 200 MB at the defaults). Peak render memory is about `concurrency × (maxFileSize + 4 × maxInputPixels)`, plus `cacheBytes` for the cache. Lower `concurrency` or `maxInputPixels` on small machines.

- [Documentation](https://github.com/mikekuss/lazy-ease#server): URL contract, limits, errors, options, CDN notes
- [Changelog](https://github.com/mikekuss/lazy-ease/blob/main/CHANGELOG.md)

## License

MIT
