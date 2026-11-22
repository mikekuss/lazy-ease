// The self-starting script, published as `@lazy-ease/vanilla/lazy-ease.min.js`.
// Its script tag activates it: it enhances every area marked `data-le-auto`
// once the document is parsed, and leaves no globals behind.
//
//   <script defer src="/assets/lazy-ease.min.js" data-base-url="/_img" data-formats="webp jpeg"></script>
//
// `data-base-url` configures the reference loader for `data-le-src` images;
// without it only prepared and native images work, and no URL is built in the
// browser. `data-formats` lists the formats the backend renders, best first;
// AVIF among them is probed once. `data-root-margin` and `data-dwell-time` set
// the preload zone. An invalid setting is reported on the console and ignored;
// the script still starts. `lazy-ease.prepared.min.js` (auto-prepared.ts) is
// the same script without measured images.
import { createLazyEase, createLoader, detectAvif, type ImageFormat } from '@lazy-ease/core'
import { boot } from './boot.js'

const FORMATS = ['avif', 'webp', 'jpeg']

boot(createLazyEase, (data, config, ignore) => {
  let formats = data.formats?.split(/[\s,]+/).filter(Boolean) as ImageFormat[] | undefined
  if (formats?.some((format) => !FORMATS.includes(format))) {
    ignore('formats')
    formats = undefined
  }
  config.loader = createLoader(formats?.length ? { baseUrl: data.baseUrl, formats } : { baseUrl: data.baseUrl })
  config.detectFormat = detectAvif
})
