# lazy-ease

Lazy-loaded, optimized images for React with a smooth fade-in.

> Status: early work in progress. The API may still change.

## Idea

```tsx
import { Image } from 'lazy-ease'

<Image src="/photos/mountain.jpg" aspectRatio={16 / 9} alt="Mountain at sunrise" />
```

- **Right size, right format.** You give a size or an aspect ratio. The component builds a `srcset`, and the backend serves a resized, optimized variant (WebP/AVIF).
- **Lazy by default.** Images load when they approach the viewport. The preload distance is configurable, or you can use the browser's native `loading="lazy"`.
- **Placeholder and crossfade.** A tiny inline SVG placeholder shows right away, then the real image fades in once it has loaded.
- **Self-hostable backend.** It starts as a Node server and later moves to edge functions behind a CDN.
- **Planned: focus points.** Crops center on a point you choose instead of the middle of the image.

## License

[MIT](LICENSE)
