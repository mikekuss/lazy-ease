# Image recipes for 0.3

These examples describe the planned API. The server owns variants in every example. A PHP template can consume a manifest written at upload time, render a single optimized URL, or implement the canonical loader using the JSON conformance fixtures.

## Start with one server-rendered image

This is a complete native example for a 1600 × 1000 original. CSS reserves its ratio and limits the article column. The two files in srcset must actually contain 640 and 1440 pixels across.

```html
<img alt="Footpath through the dunes" width="1600" height="1000"
     style="display:block;width:100%;max-width:720px;height:auto"
     loading="lazy" decoding="async"
     src="/_img/dunes.jpg?fmt=webp&amp;q=75&amp;w=640"
     srcset="/_img/dunes.jpg?fmt=webp&amp;q=75&amp;w=640 640w,
             /_img/dunes.jpg?fmt=webp&amp;q=75&amp;w=1440 1440w"
     sizes="(min-width: 720px) 720px, 100vw">
```

For the default fade, install the vanilla assets once and opt in a region. This PHP template receives an already optimized URL in `$url`. It works even when the backend knows only one variant. The template knows the display ratio independently of the source metadata.

```php
<link rel="stylesheet" href="/assets/lazy-ease.css">
<script defer src="/assets/lazy-ease.min.js"></script>
<section data-le-auto>
  <span data-le style="display:block;aspect-ratio:4/3;background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Cpath fill='%23bbc8cf' d='M0 0h1v1H0z'/%3E%3C/svg%3E&quot;);background-size:cover">
    <img alt="Footpath through the dunes" width="400" height="300"
         style="display:block;width:100%;height:100%;object-fit:cover"
         src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
         data-le-url="<?= htmlspecialchars($url, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8') ?>">
  </span>
</section>
```

For a prepared responsive list add `data-le-srcset` and `data-le-sizes` to the same img. Escape the entire attribute value for HTML after constructing URLs. The IIFE only copies those values. For client measurement use `data-le-src` instead and provide a compatible loader. Use the native example for content that must survive a failed script. Add a noscript native image only when disabled scripting needs a fallback. Reserve a single layout slot for both presentations.

The recipes below show the image-specific part of each integration. For deferred HTML apply attributes to the valid placeholder img above. For vanilla, render that element and its required box before attaching. The adapter never creates the box.

```js
import { createLazyEase, createLoader } from '@lazy-ease/core'
import { enhance } from '@lazy-ease/vanilla'
import '@lazy-ease/vanilla/lazy-ease.css'

const le = createLazyEase({ loader: createLoader({ baseUrl: '/_img' }) })
enhance(le, document.querySelector('main')) // for declarative HTML
// For individually managed elements use le.attach(img, options) and destroy on removal.
```

## Dynamic hero, breakpoint focus and priority

The mobile art director supplies a square crop with focus at 30%, 45%. Desktop gets a wide crop of another original with focus at 65%, 40%. The initial HTML determines both the source and the reserved ratio. Growing past 800px selects the wide source. Growing within one breakpoint can select a higher-resolution candidate. Keep the previous pixels visible during upgrades.

```html
<style>
  [data-hero] { display:block; --le-ar:1; aspect-ratio:var(--le-ar) }
  @media (min-width:800px) { [data-hero] { --le-ar:2 } }
  [data-hero] img { display:block; width:100%; height:100%; object-fit:cover }
</style>
<span data-le data-hero>
  <picture>
    <source media="(min-width:800px)" width="1600" height="800"
            srcset="/_img/coast.jpg?ar=2&amp;fmt=webp&amp;fx=65&amp;fy=40&amp;q=75&amp;w=1440 1440w,
                    /_img/coast.jpg?ar=2&amp;fmt=webp&amp;fx=65&amp;fy=40&amp;q=75&amp;w=2560 2560w" sizes="100vw">
    <img alt="Cliffs at sunrise" width="750" height="750" fetchpriority="high"
         src="/_img/cliff.jpg?ar=1&amp;fmt=webp&amp;fx=30&amp;fy=45&amp;q=75&amp;w=750"
         srcset="/_img/cliff.jpg?ar=1&amp;fmt=webp&amp;fx=30&amp;fy=45&amp;q=75&amp;w=750 750w,
                 /_img/cliff.jpg?ar=1&amp;fmt=webp&amp;fx=30&amp;fy=45&amp;q=75&amp;w=1440 1440w" sizes="100vw">
  </picture>
</span>
```

**React** supplies these same source records to Image. Set the CSS breakpoint on the surrounding element. **Vanilla** can adopt the native HTML with `le.attach(img, { priority: true })`. For the standard fade, the template instead puts candidate lists and sizes in deferred attributes on source and img, includes the placeholder, and calls enhance. The IIFE covers plain PHP.

```tsx
const desktop = {
  media: '(min-width:800px)', src: '/coast.jpg', aspectRatio: 2,
  srcWidth: 4000, srcHeight: 2400, focalPoint: { x: 65, y: 40 }, sizes: '100vw'
}
<div data-hero style={{ position: 'relative' }}>
  <Image priority fill src="/cliff.jpg" alt="Cliffs at sunrise" aspectRatio={1}
         srcWidth={2400} srcHeight={2000} focalPoint={{ x: 30, y: 45 }}
         sources={[desktop]} sizes="100vw" />
</div>
```

**Backend:** approve each source/crop pair including its optional focus. Publish oriented dimensions, permitted widths and decoded output dimensions. Supply a separate token per crop if signing is enabled. For a hero using the same original with browser crop, serve one uncropped ladder. The needed source width is the larger of box width and box height times source ratio, including after a height-only resize. Give a native hero corresponding sizes hints for each breakpoint. Avoid an unconditional desktop preload on mobile.

## Static breakpoint ratios

A card may use the same source at 4:3 below 800px and 2:1 above it. Use the hero's picture and CSS pattern with `--le-ar:4/3` as the base. Remove priority and use the deferred lists for a fade.

| Integration | Card-specific code |
| --- | --- |
| React | `<Image src="/lake.jpg" alt="Lake" aspectRatio={4/3} sources={[{ media:'(min-width:800px)', src:'/lake.jpg', aspectRatio:2, sizes:'50vw' }]} sizes="100vw" />` |
| Vanilla | Render the prepared picture, then `enhance(le, card)`. |
| PHP HTML | Desktop source carries `media="(min-width:800px)" data-le-sizes="50vw"` and the wide crop list. The fallback img carries `data-le-sizes="100vw"` and the 4:3 list. |

**Backend:** snap to canonical ratios 1.333 and 2, generate a ladder per crop, and provide a single URL if source dimensions are unavailable.

## Fixed sizes, retina and avatars

A 56px square avatar uses 64px and 128px candidates for a sufficiently large source. Retina selection is native to srcset. A 40px original can only produce 40px; collapse that result to one URL. For an ordinary fixed card substitute 320 × 240 and the corresponding 4:3 crop.

```tsx
<Image src="/ada.jpg" alt="Ada" width={56} height={56}
       srcWidth={1000} srcHeight={1000} focalPoint={{ x: 40, y: 30 }} />
```

```js
le.attach(img, { src: '/ada.jpg', width: 56, height: 56,
  srcWidth: 1000, srcHeight: 1000, focalPoint: { x: 40, y: 30 } })
```

```html
<!-- Attributes for the prepared placeholder img. The enclosing box reserves 56 × 56. -->
<img alt="Ada" width="56" height="56" data-le-sizes="56px"
     src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs="
     data-le-srcset="/_img/ada.jpg?ar=1&amp;fmt=webp&amp;fx=40&amp;fy=30&amp;q=75&amp;w=64 64w,
                     /_img/ada.jpg?ar=1&amp;fmt=webp&amp;fx=40&amp;fy=30&amp;q=75&amp;w=128 128w">
```

**Backend:** allow the avatar crop and optional CMS focus. Use actual oriented crop width in the descriptors. For fixed cards offer rounded 1×/2× candidates within the available crop pixels.

## Fill gallery

Give each cell a positioned parent with a definite size. For a square grid reserve it using aspect-ratio:1. For adaptive cells use the dimensions provided by the grid. Keep hidden cells idle.

| Integration | Image inside the positioned cell |
| --- | --- |
| React | `<Image src="/fern.jpg" alt="Fern" fill srcWidth={2400} srcHeight={1600} />` |
| Vanilla | `le.attach(img, { src:'/fern.jpg', fill:true, srcWidth:2400, srcHeight:1600 })` |
| PHP HTML | On the boxed placeholder img set `data-le-src="/fern.jpg" data-le-fill data-le-srcw="2400" data-le-srch="1600"`. Position the box with `position:absolute;inset:0`. |

**Backend:** serve uncropped widths for adaptive browser crop. For known square cells set aspectRatio to 1 and approve a square server crop. With private sources and unknown future ratios choose browser crop or a finite signed crop list.

## Intrinsic article and minimal single URL

Use the first native HTML example for a full article. In React use `<Image src="/dunes.jpg" alt="Dunes" srcWidth={1600} srcHeight={1000} sizes="(min-width:720px) 720px, 100vw" />`. In vanilla use `le.attach(img, { src:'/dunes.jpg', srcWidth:1600, srcHeight:1000 })` for a measured slot. The original ratio reserves space without imposing a rendered pixel width. The single-URL PHP example above also works as an entry-level backend.

**Backend:** preserve the original ratio, publish oriented metadata when available, and only label variants whose encoded widths are known.

## Decorative CSS background

```css
[data-banner] { aspect-ratio:2; background:#64756c center / cover no-repeat }
[data-banner][data-le-visible] {
  background-image:image-set(url("/assets/banner-750.webp") 1x,
                             url("/assets/banner-1440.webp") 2x)
}
```

**HTML:** `<div data-le-background data-banner aria-hidden="true"></div>` inside the opt-in area. **Vanilla:** `enhance(le, bannerSection)`. **React:** render the same div and observe its ref from an effect using the core visibility helper, set the marker once and clean up on unmount. A CSS author can use media queries for other slot widths; the optional core imageSet helper builds the CSS value.

**Backend:** publish the referenced resolution/format candidates with bounded widths. Choose source assets appropriate for the CSS slot. The marker reports eligibility for loading. Meaningful content images use img and alt.

```tsx
import { useEffect, useRef } from 'react'
import { whenVisible } from '@lazy-ease/core'

function Banner() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const banner = ref.current
    if (banner) return whenVisible(banner, { rootMargin: '400px', dwellTime: 0 },
      () => banner.setAttribute('data-le-visible', ''))
  }, [])
  return <div ref={ref} data-banner aria-hidden="true" />
}
```

## SVG, animation and external images

| Asset | React | Vanilla | PHP HTML attribute on the prepared img |
| --- | --- | --- | --- |
| Logo | `<Image src="/logo.svg" alt="Club" width={120} height={40} />` | `le.attach(img, {src:'/logo.svg', width:120, height:40})` | `data-le-url="/logo.svg"` |
| Animated original | `<Image src="/wave.gif" alt="Waving hand" width={64} height={64} />` | `le.attach(img, {src:'/wave.gif', width:64, height:64})` | `data-le-url="/wave.gif"` |
| External photo | `<Image src="https://images.example.org/fern.jpg" alt="Fern" width={320} height={240} />` | `le.attach(img, {src:'https://images.example.org/fern.jpg', width:320, height:240})` | `data-le-url="https://images.example.org/fern.jpg"` |

**Backend:** serve owned originals with the correct content type. External resources load from their original origin. Preserve query and fragment on pass-through URLs. An SVG data URI follows the same path. Neither the reference renderer nor a remote-image proxy is needed for these cases.

## Authenticated image in a shadow tree

Supply CSS inside the shadow root. Configure one controller for the widget and destroy attachments on disconnect. Its intersection root is the scrolling panel. An outer document scan does not enter the shadow tree.

```js
import { createLazyEase, createLoader } from '@lazy-ease/core'
import { cssText } from '@lazy-ease/vanilla/css'
const sheet = new CSSStyleSheet()
sheet.replaceSync(cssText)
shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, sheet]
const loader = createLoader({ baseUrl:'/media', widths:[128,256,512,1024],
  ratios:[1], qualities:[75], formats:['webp'] })
const le = createLazyEase({ loader, root:panel })
const handle = le.attach(img, { src:'/fern.jpg', width:128, height:128,
  srcWidth:1600, srcHeight:1200, token:cropToken, version:revision })
// On disconnect: handle.destroy()
```

**React:** mount inside the shadow tree, supply the same loader and root to the provider and pass token/version on Image. **Server HTML:** put `data-le-src="/fern.jpg" data-le-ar="1" data-le-token="…"` and the matching revision, dimensions and accessible name on the placeholder img, then enhance that shadow root with its configured instance. A prepared signed list also works without client URL building.

**Backend:** check viewer access before every shared cache hit, bind crop permission to source identity and revision, and admit only configured widths and WebP. Sign on the backend. Keep private assets within their authorization namespace.

```tsx
<LazyEaseProvider loader={loader} root={panel}>
  <Image src="/fern.jpg" alt="Fern" width={128} height={128}
         srcWidth={1600} srcHeight={1200} token={cropToken} version={revision} />
</LazyEaseProvider>
```

## Demo acceptance

Publish two direct entry URLs using the same hero. The fade view supports throttling and late activation. The LCP view emits the hero in the first HTML and excludes metrics overlays, comparison HEAD requests and service-worker throttling. Show fixed/DPR, breakpoint ratio/focus, fill and intrinsic article examples together with requested and delivered dimensions. Include the native/JS PHP pair, CSS background, SVG, GIF, external and shadow-panel cases. Precompute public assets for the static demo. On the live backend show authorized access, denied crop, cache hit and regeneration after eviction. Keep UI labels short.
