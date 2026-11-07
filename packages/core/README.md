# @lazy-ease/core

The framework-free part of lazy-ease: the default width and ratio ladders, canonical URL numbers, focal crop geometry, the reference loader, candidate selection and the DOM image controller. It has no dependencies. The pure functions touch neither the DOM nor Node APIs, so they run in a browser, a worker, a Node server or a build script. Importing the package does nothing: no detection, no DOM access, no observers and no ladder computation, and it needs no `process` global.

```bash
npm install @lazy-ease/core
```

```js
import { createLoader, cropWindow, outputSize } from '@lazy-ease/core'

const loader = createLoader({ baseUrl: '/_img' })
loader.url({ src: '/lake.jpg', width: 640, aspectRatio: 1, quality: 75, format: 'webp' })
// '/_img/lake.jpg?ar=1&fmt=webp&q=75&w=640'

outputSize(1200, 400, { width: 640, aspectRatio: 1 })
// { requestWidth: 640, width: 400, height: 400 }: the backend never upscales
```

`candidateSet()` turns request widths into the srcset a browser chooses from, labeled with the width the backend actually encodes and merged where two requests encode the same pixels:

```js
import { candidateSet, measuredCandidates } from '@lazy-ease/core'

candidateSet({ src: '/strip.jpg', widths: [256, 384, 640], srcWidth: 2000, srcHeight: 300,
  aspectRatio: 1, quality: 75, format: 'webp', loader })
// { srcset: '/_img/strip.jpg?ar=1&fmt=webp&q=75&w=256 256w, /_img/strip.jpg?ar=1&fmt=webp&q=75&w=384 300w', src: … }
```

## Controller

`createLazyEase(config)` returns an instance whose `attach(img, options)` takes over one image the template rendered: the img and, for a fade, its box, the nearest `[data-le]` element. The template reserves the geometry and supplies an inert source and a placeholder; the controller owns the deferred source attributes, the `data-state` of the owner, the fade and the placeholder styles.

```js
import { createLazyEase, createLoader } from '@lazy-ease/core'

const le = createLazyEase({ loader: createLoader({ baseUrl: '/_img', formats: ['webp'] }) })

// Prepared: copies the values on intersection. Needs no loader and reads no layout.
le.attach(cardImg, { srcset: '/a-640.webp 640w, /a-1280.webp 1280w', sizes: '50vw' })
// Measured: observes the box's content size and installs the loader's candidates.
const handle = le.attach(cellImg, { src: '/fern.jpg', fill: true, srcWidth: 2400, srcHeight: 1600 })
// Native: adopts the sources in the HTML, here with eager loading and high fetch priority.
le.attach(heroImg, { priority: true })

handle.update({ src: '/lake.jpg', fill: true }) // a new source: back to its placeholder
handle.destroy() // releases listeners, observers, timers and the claim on the element
```

| Option | Meaning |
| --- | --- |
| `src` / `srcset`, `sizes`, `url` / `priority`, `loading: 'native'` | One source mode: measured, prepared, or native. Mixing them throws before the element is touched. A measured `src` needs a `loader` in the config or the options, unless it loads directly. |
| `width`, `height`, `aspectRatio`, `fill` | Layout, as in the HTML. Fixed and ratio boxes crop on the server at the snapped ratio. |
| `crop` | `'browser'` or `'server'`. A fill image with both source dimensions defaults to browser crop: the uncropped source at the cover width, max(box width, box height × source ratio). |
| `srcWidth`, `srcHeight`, `focalPoint`, `version`, `quality` | Source geometry, focus, revision and quality for the loader. |
| `placeholder` | A color, a data URI, `thumbhash:…` (with a registered decoder) or `'none'`. Default: whatever the HTML paints on the box. |
| `loading: 'eager'`, `root`, `rootMargin`, `dwellTime` | When to activate. Default: within 400px of the viewport, observed through one shared IntersectionObserver per root and margin. |
| `fadeDuration`, `onStateChange(state, img)`, `onDisplay(img, event?)` | A 400 ms fade after load and decode, skipped for reduced motion. `onDisplay` reports the first display of each source once, with the load event only when one was observed. |

External URLs, SVG and GIF load directly. A loader with one format or `formats: 'auto'` needs no format probe; otherwise an AVIF decode test runs once, on first need, and WebP is the fallback. Measured images grow their candidates after a 200 ms trailing debounce and never shrink them; a failed upgrade keeps the image that is displayed. A failed first load or decode releases the placeholder and reports `error`. An element can be attached once; the claim is shared by every copy of the package on the page.

`whenVisible(element, { root, rootMargin, dwellTime }, callback)` is the visibility primitive on its own, for decorative backgrounds; it returns a function that cancels.

ThumbHash placeholders decode in an explicit entry point, with the `thumbhash` package the application installs:

```js
import * as thumbhash from 'thumbhash'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'

const le = createLazyEase({ thumbhash: thumbhashDecoder(thumbhash) })
```

`@lazy-ease/react` and `@lazy-ease/server` build on this package.

- [Documentation](https://github.com/mikekuss/lazy-ease#readme)
- [Changelog](https://github.com/mikekuss/lazy-ease/blob/main/CHANGELOG.md)

## License

MIT
