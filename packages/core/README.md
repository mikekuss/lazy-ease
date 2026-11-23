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

`createLoader()` checks its ladders wherever `process.env.NODE_ENV` isn't `"production"` and throws a `RangeError` for any the reference backend would reject: widths must be positive integers and ratios positive numbers, both ascending without two values of one URL spelling; qualities unique integers from 1 to 100; formats a non-empty list of `avif`, `webp` and `jpeg`. So it also runs in Node without `NODE_ENV` set. Production bundles, where the bundler replaces it with `"production"`, drop it, and a browser import without a bundler skips it. `checkLadders({ widths, ratios, qualities, formats })` runs the same check everywhere; `@lazy-ease/server` calls it when the app is created.

`candidateSet()` turns request widths into the srcset a browser chooses from, labeled with the width the backend actually encodes and merged where two requests encode the same pixels:

```js
import { candidateSet, createLoader } from '@lazy-ease/core'

candidateSet({ src: '/strip.jpg', widths: [256, 384, 640], srcWidth: 2000, srcHeight: 300,
  aspectRatio: 1, quality: 75, format: 'webp', loader: createLoader() })
// { srcset: '/_img/strip.jpg?ar=1&fmt=webp&q=75&w=256 256w, /_img/strip.jpg?ar=1&fmt=webp&q=75&w=384 300w', src: … }
```

## Controller

`createLazyEase(config)` returns an instance whose `attach(img, options)` takes over one image the template rendered: the img and, for a fade, its box, the nearest `[data-le]` element. The template reserves the geometry and supplies an inert source and a placeholder; the controller owns the deferred source attributes, the `data-state` of the owner, the fade and the placeholder styles.

```ts
import { createLazyEase, createLoader } from '@lazy-ease/core'

const le = createLazyEase({ loader: createLoader({ baseUrl: '/_img', formats: ['webp'] }) })
const image = (selector: string) => document.querySelector<HTMLImageElement>(selector)!

// Prepared: copies the values on intersection. Needs no loader and reads no layout.
le.attach(image('#card img'), { srcset: '/a-640.webp 640w, /a-1280.webp 1280w', sizes: '50vw' })
// Measured: observes the box's content size and installs the loader's candidates.
const handle = le.attach(image('#cell img'), { src: '/fern.jpg', fill: true, srcWidth: 2400, srcHeight: 1600 })
// Native: adopts the sources in the HTML, here with eager loading and high fetch priority.
le.attach(image('#hero img'), { priority: true })

handle.update({ src: '/lake.jpg', fill: true }) // a new source: back to its placeholder; an invalid root or rootMargin throws first
handle.update({ src: '/lake.jpg', fill: true, onStateChange: console.log }) // only a new callback: the image stays as it is
handle.destroy() // releases listeners, observers, timers and the claim on the element
```

| Option | Meaning |
| --- | --- |
| `src` / `srcset`, `sizes`, `url` / `priority`, `loading: 'native'` | One source mode: measured, prepared, or native. Mixing them throws before the element is touched. A measured `src` needs a `loader` in the config or the options, unless it loads directly. |
| `width`, `height`, `aspectRatio`, `fill` | Layout, as in the HTML. Fixed and ratio boxes crop on the server at the snapped ratio. |
| `crop` | `'browser'` or `'server'`. A fill image with both source dimensions defaults to browser crop: the uncropped source at the cover width, max(box width, box height × source ratio). |
| `srcWidth`, `srcHeight`, `focalPoint`, `version`, `token`, `quality` | Source geometry, focus, revision, crop token and quality for the loader. The reference loader writes the token between `q` and `v`. |
| `placeholder` | A color, a data URI, `thumbhash:…` (with a registered decoder) or `'none'`. Default: whatever the HTML paints on the box. It stays under the image until the fade ends, unless it is a ThumbHash with alpha, which fades out with it. |
| `transparent` | The placeholder painted inline by the caller stands for a transparent image (a decoded ThumbHash with alpha), so it fades out with the fade. React sets it where it paints the decoded ThumbHash itself. |
| `loading: 'eager'`, `root`, `rootMargin`, `dwellTime` | When to activate. Default: within 400px of the viewport, observed through one shared IntersectionObserver per root and margin. A root or margin the IntersectionObserver refuses throws and leaves the element as it was; on `update` the displayed image stays. |
| `fadeDuration`, `reveal`, `onStateChange(state, img)`, `onDisplay(img, event?)` | A 400 ms fade after load and decode, skipped for reduced motion. `reveal` takes keyframes for the fade instead: `focusReveal` sharpens the image from a blur of 8 % of the box's longer edge, masked to the image's box (its own `clip-path` still applies, a `mask` of its own is replaced during the reveal), and any `(edge) => Keyframe[]` works; one that throws gets the plain fade, and its error is reported. It starts from explicit keyframes and takes the box size from a ResizeObserver, so the controller reads no layout for it. `onDisplay` reports the first display of each source once, with the load event only when one was observed. |

External URLs, SVG and GIF load directly. A measured image requests the best format its loader declares other than AVIF, WebP first, or `'auto'` for `formats: 'auto'`. For AVIF, pass `detectFormat: detectAvif` in the config: with AVIF and another format declared, an AVIF decode test then runs once per page, on first need; if it takes longer than 200 ms, the image takes the best declared format other than AVIF, WebP if declared, otherwise JPEG. Without it a loader that declares AVIF besides other formats gets the best of those, `['avif', 'jpeg']` JPEG, which a development build reports once on the console; a loader that declares only AVIF gets AVIF, and a single declared format never calls the detector. Any `(formats) => format | Promise<format>` works as `detectFormat`; it is left out of a bundle that does not import it. A detector that throws or rejects is reported as an uncaught error, and the image takes the format it would take without one.

```ts
import { createLazyEase, createLoader, detectAvif } from '@lazy-ease/core'

const le = createLazyEase({ loader: createLoader(), detectFormat: detectAvif })
```

**Callbacks.** An error thrown by `onStateChange`, `onDisplay`, a `reveal` or the deferred decode of a ThumbHash is reported as an uncaught error, from a timer, as an event listener's is: `attach()` and `update()` don't throw it, and the image goes on as if the callback had done nothing. `update()` and `destroy()` inside any callback take effect at once, and the generation they ended writes nothing afterwards. The loader's `url`, `detectFormat` and the ThumbHash decoder are meant to be pure functions: a loader that throws leaves the image on its placeholder, and a decoder that throws is an error of the `attach()` or `update()` that called it. Callbacks are called without a `this`.

**Updates.** `update()` starts a new generation from the placeholder, as `destroy()` and `attach()` would, unless the new options differ from the current ones only in their functions: `onStateChange`, `onDisplay`, `reveal`, or the `url` of an inline loader with the same ladders, for the same `data-le-srcset` on picture sources. The other options are compared as JSON, so the same values in another key order count as a change; `root` and `loader` count as the same only when they are the same objects. Then, for example from a component that calls `update()` on every render, the image stays as it is: a loaded one stays on display with no placeholder, fade or report, a loading one keeps loading and fades in when it arrives, a failed one stays failed, one that waits for the viewport keeps waiting, and the new functions are called from then on. Any other change, `quality`, `focalPoint`, `sizes`, `placeholder`, `rootMargin`, a new `root` or a new loader among them, starts over as before. To load a failed image again, pass a new `version`. A changed `data-le-sizes` on a `<source>` alone is not applied to a kept image; destroy and attach it again, or pass a new `version`. A native image always starts a new generation that adopts what the element has.

Measured images grow their candidates after a 200 ms trailing debounce and never shrink them; a failed upgrade keeps the image that is displayed. A failed first load or decode releases the placeholder and reports `error`. An element can be attached once; the claim is shared by every copy of the package on the page.

### Without measured mode

`createLazyEase` from `@lazy-ease/core/prepared` is the same controller without measured mode, for pages whose templates write every candidate list or URL, or native sources: about 1.8 to 1.9 kB less after Brotli. Prepared, native and direct sources (external URLs, SVG, GIF) work as above; a `src` that the loader would build URLs for throws `src needs createLazyEase from @lazy-ease/core` before the element is touched.

```ts
import { createLazyEase } from '@lazy-ease/core/prepared'

const le = createLazyEase()
le.attach(document.querySelector<HTMLImageElement>('#card img')!, { srcset: '/a-640.webp 640w, /a-1280.webp 1280w', sizes: '50vw' })
```

`whenVisible(element, { root, rootMargin, dwellTime }, callback)` is the visibility primitive on its own, for decorative backgrounds; it returns a function that cancels. An error the callback throws is reported from a timer, and the other elements of the same observer batch still get theirs. `le.config` is the config the instance was created with, so an adapter can watch backgrounds against the same root and margin as the images.

`imageSet({ src, width, loader })` builds the CSS `image-set()` value for a decorative background: 1x and 2x (or the `densities` you pass) for every declared format, best first, with optional `aspectRatio`, `focalPoint`, `srcWidth`, `quality`, `version` and `token`:

```js
import { createLoader, imageSet } from '@lazy-ease/core'

imageSet({ src: '/banner.jpg', width: 700, aspectRatio: 2, loader: createLoader({ formats: ['webp'] }) })
// 'image-set(url("/_img/banner.jpg?ar=2&fmt=webp&q=75&w=750") 1x type("image/webp"), url("/_img/banner.jpg?ar=2&fmt=webp&q=75&w=1440") 2x type("image/webp"))'
```

ThumbHash placeholders decode in an explicit entry point, with the `thumbhash` package the application installs:

```js
import * as thumbhash from 'thumbhash'
import { createLazyEase } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'

const le = createLazyEase({ thumbhash: thumbhashDecoder(thumbhash) })
```

The decoded image is drawn blurred in an SVG, by 8 % of its longer edge (`thumbhashDecoder(thumbhash, { blur })`, `0` for the raw PNG). A ThumbHash with alpha stays transparent.

`@lazy-ease/vanilla`, `@lazy-ease/react` and `@lazy-ease/server` build on this package.

- [Documentation](https://github.com/mikekuss/lazy-ease#readme)
- [Changelog](https://github.com/mikekuss/lazy-ease/blob/main/CHANGELOG.md)

## License

MIT
