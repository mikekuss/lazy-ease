# @lazy-ease/server

The reference image backend for [`lazy-ease`](https://www.npmjs.com/package/lazy-ease): a [Hono](https://hono.dev) app that resizes, crops and encodes images with [sharp](https://sharp.pixelplumbing.com), plus metadata tooling for upload or build scripts. Node 22+.

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

It serves `GET /_img/{src path}?ar&fmt&q&v&w`, accepts only the canonical URLs `lazy-ease`'s default loader writes (anything else is a `400`), never upscales, strips metadata and sends year-long `immutable` caching headers for a CDN.

```ts
import { computeMetadata } from '@lazy-ease/server'

const { width, height, thumbhash, color } = await computeMetadata('./images/photos/lake.jpg')
```

- [Documentation](https://github.com/mikekuss/lazy-ease#server): URL contract, limits, errors, options, CDN notes
- [Changelog](https://github.com/mikekuss/lazy-ease/blob/main/CHANGELOG.md)

## License

MIT
