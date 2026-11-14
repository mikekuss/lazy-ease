# @lazy-ease/server

The reference image backend for [`@lazy-ease/react`](https://www.npmjs.com/package/@lazy-ease/react) and `@lazy-ease/core`: a [Hono](https://hono.dev) app that resizes, crops and encodes images with [sharp](https://sharp.pixelplumbing.com), plus metadata tooling for upload or build scripts. Node 22+.

```bash
# Not on npm yet; for now, use it from this repository.
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

It serves `GET /_img/{src path}?ar&fmt&fx&fy&q&token&v&w` (and `HEAD`), accepts only the canonical URLs the core loader writes, never upscales and strips metadata. The [backend guide](../../docs/backend.md) describes the contract this package implements.

```ts
import { computeMetadata } from '@lazy-ease/server'

const { width, height, thumbhash, color, revision } = await computeMetadata('./images/photos/lake.jpg')
```

## Admission

Every request passes these checks, in this order, before a cache lookup:

1. **Canonical query** (`400`). Keys in the order `ar fmt fx fy q token v w`, once each, values in the loader's exact spelling. `w`, `fmt` and `q` are required and must be in `widths`, `formats` and `qualities`; `ar` must be on `ratios`. The fixtures in `@lazy-ease/testing` (`backend.json`) list the accepted and rejected forms.
2. **Source path** (`400`). Each segment is decoded as UTF-8 on its own and NFC-normalized; malformed escapes, encoded slashes, empty and dot segments, backslashes, colons, NUL and a leading `//` are refused, and so are types other than JPEG, PNG, WebP, AVIF and GIF. Other spellings of a valid path (lowercase hex, NFD, over-encoded letters) serve the same variant: same bytes, ETag and cache entry.
3. **Policy** (`404`). `policy({ tenant, path })` returns the source's `SourcePolicy`, by its canonical path. `undefined` makes it a `404`.
4. **Viewer** (`403`). A private source is served only when `authorize(request, source)` returns true. This runs before the file system, the cache and any `304`.
5. **File** (`404`, `413`). Resolved with `realpath` inside `root`, symlinks included; `maxFileSize` is checked before decoding, `maxInputPixels` when decoding. The canonical path must be the file's own: another letter case on a case-insensitive file system (Windows, macOS), a Windows 8.3 short name or a symlink inside the root is a `404`, so policy and `authorize` always see the name the file is stored under. Hard links are separate names and are served under each; don't hard-link private sources into public paths.
6. **Revision** (`404`). A `v` must equal the source's current revision. A request without `v` is admitted and revalidates.
7. **Crop** (`403`). A valid crop token admits the crop it covers. Without a token, the crop must be in the policy's `crops`.

Then a matching `If-None-Match` is a `304`, a warm variant is served from memory, and anything else goes through the render queue (`503`, `504`). Error responses carry `Cache-Control: no-store`; a `500` says only `Internal Server Error`.

### Source policy

```ts
createImageApp({
  root: './images',
  policy: async ({ path }) => {
    const record = await uploads.find(path) // your upload or build record
    if (!record) return undefined           // 404
    return {
      revision: record.revision,            // what templates write into v
      focalPoint: record.focus,             // { x: 30, y: 45 }
      crops: [{}, { aspectRatio: 1, focalPoint: record.focus }, { aspectRatio: 1.778 }],
      private: record.private,
    }
  },
  authorize: (request, { path }) => sessions.mayView(request, path),
})
```

| Field | Default | |
| --- | --- | --- |
| `revision` | the content revision | The current revision of the bytes, `[A-Za-z0-9._~-]{1,64}`; anything else is a `500`. `computeMetadata` returns the default one (`revision`, a SHA-256 prefix of the file). A revision of your own must change whenever the bytes change. |
| `focalPoint` | none | The recorded focus. With the default `crops`, every ladder ratio is admitted centered on it. |
| `crops` | uncropped plus every ladder ratio at `focalPoint` | The crops admitted without a token. `{}` is the uncropped image; list it to admit it. Ratios must be on the ladder; a focus is normalized as the URL writes it (whole percent, the center absent). |
| `private` | `false` | Needs `authorize`; responses are `Cache-Control: private, no-cache`. |

The default policy admits 74 crops per source (uncropped and the 73 centered ratios), each with 13 widths × 3 formats × 1 quality = 39 outputs, all for the current revision only. A focus other than the recorded one needs a token.

### Crop tokens

Tokens are optional. They let a deployment admit crops it did not list, such as an editor's per-image focus, without publishing every crop in the policy. The byte format and test vectors are in [`@lazy-ease/testing`](../testing/README.md#crop-token).

```ts
import { createImageApp, signCropToken } from '@lazy-ease/server'

const keys = { k1: Buffer.from(process.env.CROP_KEY_K1!, 'hex') } // at least 16 bytes
createImageApp({ root: './images', tenant: 'acme', keys })

// On the backend (upload hook or template), never in browser code:
const token = signCropToken({ tenant: 'acme', source: '/cliff.jpg', revision: 'r7', ar: '1', fx: '30', fy: '45' }, 'k1', keys.k1)
// The template passes it as data-le-token or the token prop; the loader writes it between q and v.
```

A token covers the tenant, the canonical source path, `v` and the crop (`ar`, `fx`, `fy`); width, format and quality stay free within the ladders, so one token serves 39 outputs. A token is checked in constant time; an invalid one is a `403`, even for a crop the policy lists. Without `keys`, or with an empty `keys` map, a `token` parameter is a `400`. Tokens have no expiry and do not replace `authorize`. Rotate keys by key id. The token is not part of the variant identity, so the same crop with and without a token is one cache entry and one ETag.

### Caching headers

| Request | `Cache-Control` |
| --- | --- |
| `v` equals the current revision | `public, max-age=31536000, immutable` |
| no `v` | `public, no-cache`, revalidated through the `ETag` |
| private source | `private, no-cache`, with or without `v`: every revalidation runs `authorize` again, so revoked access ends |
| any error | `no-store` |

The `ETag` hashes the variant identity: tenant, canonical source, revision, the file's size and mtime, the transform profile (`TRANSFORM_PROFILE`), format, width, quality, crop and, for AVIF, `avifEffort`. A new revision or new bytes give a new ETag. `HEAD` returns the same headers without the body; for a variant that is not cached yet it renders it, sharing the queue and its limits with `GET`. `If-None-Match` (weak comparison, `*` included) gives a `304` after admission.

**Replacing sources.** With the default revision, the server hashes the file once and remembers the result by path, size and mtime; each render reads the file once more, checks those bytes against the revision and renders them, so a render never encodes changed bytes under the old revision (the request is a `503` with `Retry-After: 1` and the next one sees the new bytes). Replace a source atomically (write a new file, then rename it over the old one) and give it a new mtime: then every request sees the new revision at once. A rewrite that keeps the size and the mtime (`cp -p`, `rsync -t`, an in-place edit within the same mtime tick) is only partly handled. A `v` that misses the remembered revision makes the server hash the file once more before the `404`, so the new `v` is served from its first request after any rehash in the previous second; that rehash runs in the hashing queue, one per source at a time, and misses within a second of it reuse its result, so random `v` values cannot cause more than one read per source and second. A `v` the file had before (the server remembers the last few revisions of recently hashed files) is a `404` without a rehash, so pages and crawlers that still carry the previous deploy's `v` cost no reads. Until such a miss or a render reads the new bytes, though, variants of the old bytes in the memory cache are still served as hits: under unversioned URLs (`public, no-cache`, same ETag) and under the old `v` (`immutable`). A revision from `policy` is not checked against the bytes: it must change whenever they do.

### Originals

A GIF or SVG requested without a query, or with `v` alone (`/_img/logo.svg?v=r2`), is served unchanged: GIFs with their animation, SVGs with `Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox`. The bytes are checked to be a GIF or SVG first, and a GIF's frame size counts against `maxInputPixels`. Revisions, private policy and conditional requests apply as for variants. `originals: ['gif']` or `[]` limits or turns off pass-through. A GIF with a transform query still renders its first frame.

## Render capacity

`concurrency` renders run at once and up to `maxPending` more wait. A request for a new variant beyond that is a `503` with `Retry-After` (the timeout in seconds, rounded up). Concurrent requests for one variant share one render. Hashing a source for its default revision reads the whole file, so it has a queue of the same size of its own, and a cold source, or a rehash after a missed `v`, is a `503` there too when that queue is full.

The `timeout` deadline starts at admission, so time in the queue counts. When it passes, the response is a `504`, but the render keeps its slot and its key until sharp's work actually ends: sharp gets the full timeout when the render starts and stops decode and resize work after it (whole seconds, rounded up), while an AVIF encode already running finishes, bounded by `avifEffort`. A request for the same variant meanwhile joins that work instead of starting another, and its result is kept in the cache. A queued render whose callers have all timed out is dropped without starting.

## Options

| Option | Default | |
| --- | --- | --- |
| `root` | required | Directory the source images are read from. |
| `widths`, `ratios`, `qualities`, `formats` | the loader defaults | Must match the loader's. `formats` is any of `avif`, `webp`, `jpeg`. |
| `tenant` | `default` | Namespace for the variant identity and crop tokens, `[A-Za-z0-9._~-]{1,64}`. |
| `policy` | every source public, default revision and crops | See [Source policy](#source-policy). |
| `keys` | none | Crop token keys by key id. An empty map is the same as none. |
| `authorize` | none | Viewer check for private sources. |
| `originals` | `['gif', 'svg']` | Types passed through unchanged. |
| `maxFileSize` | 32 MB | Larger sources are a `413`, checked before decoding. |
| `maxInputPixels` | 50 MP | Larger sources are a `413`. |
| `timeout` | 10 s | Response deadline from admission, in ms; see [Render capacity](#render-capacity). |
| `concurrency` | half the CPUs, at least 1 | Renders running at once; libvips adds its own threads per render. |
| `maxPending` | 4 × `concurrency` | Renders waiting for a slot; hashing has its own queue of this size. |
| `cacheSize` | 200 | Encoded images kept in the in-memory LRU. `0` turns it off. |
| `cacheBytes` | 64 MB | Total size of the LRU; the oldest entries go first. `0` turns it off. |
| `avifEffort` | 4 | AVIF encoder effort, `0` (fastest) to `9` (smallest files). |

**Memory.** Each running render holds the source file (up to `maxFileSize`) and its decoded pixels (up to `maxInputPixels` × 4 bytes, 200 MB at the defaults). With the default revision, a cold source is read twice: once in the hashing queue and once by its render, and the hashing queue runs up to `concurrency` reads of its own. Peak memory is about `concurrency × (2 × maxFileSize + 4 × maxInputPixels)`, plus `cacheBytes` for the cache. Lower `concurrency` or `maxInputPixels` on small machines.

## Rollout

Admission is stricter than in 0.2. Deploy the server, its policy and the CDN configuration before clients that send new URL fields, and check existing URLs against it:

- `q` is required. The 0.3 loader always writes it.
- `v` must name the current revision. Publish revisions (`computeMetadata().revision`, or your own through `policy`) and let templates write them; URLs with any other `v` are a `404`. URLs without `v` keep working and revalidate.
- Focal crops need a recorded focus, a listed crop or a token. Uncropped images and centered ladder crops keep working with the default policy.
- A CDN must key on `ar fmt fx fy q token v w`, or authorize the viewer and verify the token on the viewer-request path before dropping `token` from its key. Private sources need the viewer check before every hit.

- [Documentation](https://github.com/mikekuss/lazy-ease#server): URL contract, limits, errors, options, CDN notes
- [Changelog](https://github.com/mikekuss/lazy-ease/blob/main/CHANGELOG.md)

## License

MIT
