# @lazy-ease/core

The framework-free part of lazy-ease: the default width and ratio ladders, canonical URL numbers, focal crop geometry, the reference loader and candidate selection. It has no dependencies and touches neither the DOM nor Node APIs, so the same functions run in a browser, a worker, a Node server or a build script.

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

`@lazy-ease/react` and `@lazy-ease/server` build on this package.

- [Documentation](https://github.com/mikekuss/lazy-ease#readme)
- [Changelog](https://github.com/mikekuss/lazy-ease/blob/main/CHANGELOG.md)

## License

MIT
