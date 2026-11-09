# @lazy-ease/vanilla

lazy-ease for server-rendered HTML: a PHP template, a static site or any markup you write yourself. The template renders the image, its box and an inline placeholder. This package finds the marked images and hands them to the controller from [`@lazy-ease/core`](../core), which loads them when they come near the viewport and fades them in. It also ships the stylesheet and a script that starts itself.

```bash
npm install @lazy-ease/vanilla
```

## Without a bundler

Copy `node_modules/@lazy-ease/vanilla/dist/lazy-ease.min.js` and `lazy-ease.css` to your assets, link them once, and mark the areas the script may enhance with `data-le-auto`:

```html
<link rel="stylesheet" href="/assets/lazy-ease.css">
<script defer src="/assets/lazy-ease.min.js"></script>

<section data-le-auto>
  <span data-le style="aspect-ratio:4/3;background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Cpath fill='%23bbc8cf' d='M0 0h1v1H0z'/%3E%3C/svg%3E&quot;)">
    <img alt="Footpath through the dunes" width="400" height="300"
         src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
         data-le-url="/_img/dunes.jpg?fmt=webp&amp;q=75&amp;w=640">
  </span>
</section>
```

The script enhances every `data-le-auto` area once the document is parsed and leaves no globals behind. Prepared and native images need nothing else: the browser builds no URL and measures no layout for them. For `data-le-src` images, which the browser measures, configure the reference loader on the script tag:

| Script attribute | Meaning |
| --- | --- |
| `data-base-url` | Where the backend is mounted, e.g. `/_img`. Without it, `data-le-src` images are reported on the console and left alone. |
| `data-formats` | Formats the backend renders, best first, e.g. `webp jpeg`. Default: AVIF, WebP and JPEG, probed once. |
| `data-root-margin`, `data-dwell-time` | Preload zone: CSS margin (default `400px`) and how long an image must stay in it, in ms (default 0). |

An invalid setting, such as an unknown format, a margin without units or a negative dwell time, is reported on the console and ignored; the script still starts with the default for it.

Content added after the script ran is not enhanced on its own. Use the ESM API for pages that change.

## With a bundler

```js
import { createLazyEase, createLoader } from '@lazy-ease/core'
import { enhance } from '@lazy-ease/vanilla'
import '@lazy-ease/vanilla/lazy-ease.css'

const le = createLazyEase({ loader: createLoader({ baseUrl: '/_img' }) })
const enhanced = enhance(le, document.querySelector('main'))
// Later, e.g. before the area is removed:
enhanced.destroy()
```

`enhance(le, root)` takes a document, an element or a shadow root, the root itself included, and returns a handle whose `destroy()` releases what this call attached. It skips elements another call, instance or bundle already owns, so enhancing an area again after adding content is safe. The instance's `root` (the scrolling element) is separate from the area you enhance.

`readOptions(img)` returns the attach options the attributes describe, for code that calls `le.attach()` itself.

## Markup

Each image has one source mode. The attributes go on the img; `data-le` goes on its box, or on the img when there is no box.

| Attribute | Meaning |
| --- | --- |
| `data-le` | Marks the box (or a boxless img). The controller reports `data-state` on it: `idle`, `loading`, `loaded` or `error`. |
| `data-le-srcset`, `data-le-sizes` | Prepared candidate list and slot, copied when the image comes near the viewport. |
| `data-le-url` | Prepared single URL, or the fallback of a prepared list. |
| `data-le-src` | Logical source for the configured loader. The browser measures the slot. |
| `data-le-srcw`, `data-le-srch` | Oriented source dimensions. |
| `data-le-ar`, `data-le-fill`, `data-le-crop` | Crop ratio, boolean fill, `server` or `browser` crop. `data-le-ar`, `-srcw`, `-srch` and `-q` are positive numbers. |
| `data-le-fx`, `data-le-fy` | Focal point in percent, both or neither. |
| `data-le-token`, `data-le-v`, `data-le-q` | Crop token, revision and quality, passed to the loader. |
| `data-le-background` | A decorative element. It gets `data-le-visible` once it comes near the viewport. An element marked both `data-le` and `data-le-background` is reported on the console and left alone. |
| `data-le-auto` | Opts an area in for the script. `data-le-auto="off"` keeps a subtree out of every `enhance` call, for React or Lit images that attach themselves; a nested `data-le-auto` opts back in. |

An img with none of the source attributes is native: its own `src`/`srcset` load as the browser decides, and the controller only reports its state and removes the placeholder once it has loaded. The HTML `width` and `height` stay plain dimensions; a measured crop ratio comes from `data-le-ar`. Escape every attribute value for HTML after building the URLs (`&` becomes `&amp;`).

For art direction, put `media`, `type` and dimensions on the `<source>` elements of a `<picture>` and defer their candidates with `data-le-srcset` and `data-le-sizes`, as on the img. A picture defers all of its candidates or none: a deferred img with a native `srcset` source, or a native img with a `data-le-srcset` source, is reported on the console and left alone.

## Decorative backgrounds

```css
[data-banner] { aspect-ratio:2; background:#64756c center / cover no-repeat }
[data-banner][data-le-visible] { background-image:image-set(url("/_img/banner.jpg?fmt=webp&q=75&w=750") 1x, url("/_img/banner.jpg?fmt=webp&q=75&w=1440") 2x) }
```

`imageSet()` from `@lazy-ease/core` builds that value from a loader, in a build script or a Node template.

## Stylesheet

`lazy-ease.css` makes a box a block, lets its img and placeholder cover it and hides the alt text of a deferred image until it fails. Every rule has zero specificity, so your own CSS wins. The controller does not need it: the fade and the placeholder are inline styles. A shadow root does not see the document's stylesheets; adopt the same text there:

```js
import { cssText } from '@lazy-ease/vanilla/css'
const sheet = new CSSStyleSheet()
sheet.replaceSync(cssText)
shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet]
enhance(le, shadow)
```

## Content Security Policy

The placeholder and the inert image source are `data:` URIs, so `img-src` needs `data:`. The controller writes inline styles through the CSSOM, which `style-src` allows without `'unsafe-inline'`; the template's own `style` attributes need `'unsafe-inline'` (or move them into a stylesheet). The script needs no inline code.

## Without JavaScript

Native HTML works without the script. A deferred image keeps its placeholder when scripting is off or the script fails to load. Add a `<noscript>` with a native image only where that matters.
