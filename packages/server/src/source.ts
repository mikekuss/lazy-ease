import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { HTTPException } from 'hono/http-exception'

// SVG and TIFF are not backend sources (spec 2); neither are other types.
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'])

export interface Source {
  /** Real path of the file, inside the root. */
  file: string
  size: number
  mtimeMs: number
}

const invalid = (message: string) => new HTTPException(400, { message })
const notFound = () => new HTTPException(404, { message: 'Image not found' })

/**
 * Maps the (already percent-decoded) source path of a request to a file inside
 * `root` (spec 12.1). Malformed paths are a 400; missing files and anything
 * that resolves outside the root, symlinks included, are a 404.
 */
export async function resolveSource(root: string, src: string | undefined): Promise<Source> {
  if (!src) throw invalid('Missing source path')
  if (src.includes('\0')) throw invalid('Invalid source path')
  // Backslashes are separators on Windows and would dodge the checks below.
  if (src.includes('\\')) throw invalid('Backslashes are not allowed')
  // Covers URL schemes, drive letters (`C:`) and NTFS streams (`a.jpg:x`).
  if (src.includes(':')) throw invalid('Colons are not allowed')
  // `//host/share` is a UNC path once it reaches the file system.
  if (src.startsWith('/')) throw invalid('UNC and protocol-relative paths are not allowed')

  const normalized = src.normalize('NFC')
  const segments = normalized.split('/')
  // The client's URL parser removes dot segments, so these only come from hand-made URLs.
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw invalid('Dot segments are not allowed')
  }
  if (!EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
    throw invalid('Unsupported file type')
  }

  const rootDir = await realpath(root)
  let file: string
  let stats
  try {
    file = await realpath(path.join(rootDir, ...segments))
    stats = await stat(file)
  } catch {
    throw notFound()
  }
  // Symlinks could still point outside the root.
  if (!stats.isFile() || !file.startsWith(rootDir + path.sep)) throw notFound()
  // A symlink named `a.jpg` may point at an SVG.
  if (!EXTENSIONS.has(path.extname(file).toLowerCase())) throw invalid('Unsupported file type')
  return { file, size: stats.size, mtimeMs: stats.mtimeMs }
}
