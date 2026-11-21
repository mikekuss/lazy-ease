// Writes the files a page without a bundler links directly, after tsc has
// built dist/: the two self-starting scripts and the stylesheet, which is the
// same text as the `./css` export.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildScript } from './bundle.mjs'

const dist = new URL('../dist/', import.meta.url)
await buildScript({ outfile: fileURLToPath(new URL('lazy-ease.min.js', dist)) })
await buildScript({ entry: 'auto-prepared', outfile: fileURLToPath(new URL('lazy-ease.prepared.min.js', dist)) })
const { cssText } = await import(new URL('css.js', dist).href)
writeFileSync(new URL('lazy-ease.css', dist), cssText)
