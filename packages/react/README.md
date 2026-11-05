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

Images are measured on the client and loaded at their rendered size (× DPR, capped at 2), cropped by the server and in AVIF or WebP. The placeholder (a color, a data URI or a ThumbHash) is in the server HTML. The default loader targets [`@lazy-ease/server`](https://www.npmjs.com/package/@lazy-ease/server) mounted at `/_img`; imgix, Cloudinary and Cloudflare Images work through custom loaders.

Peer dependencies: `react` and `react-dom` 19.

- [Documentation](https://github.com/mikekuss/lazy-ease#readme): props, layout modes, loading, placeholders, CSP, loaders
- [Live demo](https://mikekuss.github.io/lazy-ease/)
- [Changelog](https://github.com/mikekuss/lazy-ease/blob/main/CHANGELOG.md)

## License

MIT
