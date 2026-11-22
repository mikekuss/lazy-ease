// The self-starting script without measured images, published as
// `@lazy-ease/vanilla/lazy-ease.prepared.min.js`: for pages whose templates
// write every candidate list or URL (`data-le-srcset`, `data-le-url`) or
// native sources. It builds no URL in the browser, so it has no loader:
// `data-base-url` is reported and ignored, and a `data-le-src` image that
// would need the loader is reported and left alone. `data-root-margin` and
// `data-dwell-time` work as in `lazy-ease.min.js`.
import { createLazyEase } from '@lazy-ease/core/prepared'
import { boot } from './boot.js'

boot(createLazyEase)
