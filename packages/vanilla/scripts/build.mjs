// Writes the two files a page without a bundler links directly, after tsc
// has built dist/: the self-starting script and the stylesheet, which is the
// same text as the `./css` export.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildScript } from './bundle.mjs'

const dist = new URL('../dist/', import.meta.url)
await buildScript({ outfile: fileURLToPath(new URL('lazy-ease.min.js', dist)) })
const { cssText } = await import(new URL('css.js', dist).href)
writeFileSync(new URL('lazy-ease.css', dist), cssText)
