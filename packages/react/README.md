# @lazy-ease/react

Lazy-loaded, right-sized images for React 19, with an inline placeholder and a crossfade.

```bash
npm install @lazy-ease/react
```

```tsx
import { Image, LazyEaseProvider } from '@lazy-ease/react'

<LazyEaseProvider>
  <Image src="/photos/lake.jpg" alt="Lake at dawn" width={320} height={240} />
</LazyEaseProvider>
```

`<Image>` renders the markup on the server and hands the element to the controller of [`@lazy-ease/core`](https://github.com/mikekuss/lazy-ease/tree/main/packages/core) after hydration. By default an image waits for the viewport, is measured and loaded at its rendered size (× DPR, capped at 2), cropped by the server or the browser and in AVIF or WebP, and fades in. `sizes` prepares the candidates in advance and still fades. `loading="native"` puts the real sources in the server HTML, and `priority` adds eager loading, high fetch priority and a preload for the LCP image. `sources` adds art-direction sources in a `<picture>`. The placeholder (a color or a data URI, or a ThumbHash with the decoder from `@lazy-ease/core/thumbhash` on the provider) is in the server HTML. A wrapper element is rendered only where fill, a fade, focal positioning or `wrapperClassName`/`wrapperStyle` need one; `noScript` adds a no-JS fallback. `onStateChange` reports the first display also for an image that loaded before hydration. The [migration guide](https://github.com/mikekuss/lazy-ease/blob/main/docs/migrating-from-0.2.md) lists the changes from 0.2. The default loader targets [`@lazy-ease/server`](https://github.com/mikekuss/lazy-ease/tree/main/packages/server) (not on npm yet) mounted at `/_img`; imgix, Cloudinary and Cloudflare Images work through custom loaders.

Peer dependencies: `react` and `react-dom` 19.

- [Documentation](https://github.com/mikekuss/lazy-ease#readme): props, layout modes, loading, placeholders, CSP, loaders
- [Live demo](https://mikekuss.github.io/lazy-ease/)
- [Changelog](https://github.com/mikekuss/lazy-ease/blob/main/CHANGELOG.md)

## License

MIT
