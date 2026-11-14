import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { HTTPException } from 'hono/http-exception'

// SVG and TIFF are not render sources (spec 2); neither are other types.
export const RENDER_TYPES: ReadonlySet<string> = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif'])

export interface Source {
  /** Real path of the file, inside the root. */
  file: string
  size: number
  mtimeMs: number
}

export interface SourcePath {
  /** Decoded, NFC segments. */
  segments: string[]
  /** The canonical encoded spelling, e.g. `/my%20photos/caf%C3%A9.jpg`. */
  canonical: string
  /** Lowercase extension, e.g. `.jpg`. */
  extension: string
}

const invalid = (message: string) => new HTTPException(400, { message })
const notFound = () => new HTTPException(404, { message: 'Image not found' })

/**
 * Resolves `root` with `realpath` once, on first use, instead of on every
 * request. A failure is not kept, so a root created later still works.
 */
export function realRoot(root: string): () => Promise<string> {
  let resolved: Promise<string> | undefined
  return () =>
    (resolved ??= realpath(root).catch((error: unknown) => {
      resolved = undefined
      throw error
    }))
}

/** Checks decoded segments; the result is NFC. */
function checkSegments(segments: string[], types: ReadonlySet<string>): SourcePath {
  const joined = segments.join('/')
  if (joined === '') throw invalid('Missing source path')
  if (joined.includes('\0')) throw invalid('Invalid source path')
  // Backslashes are separators on Windows and would dodge the checks below.
  if (joined.includes('\\')) throw invalid('Backslashes are not allowed')
  // Covers URL schemes, drive letters (`C:`) and NTFS streams (`a.jpg:x`).
  if (joined.includes(':')) throw invalid('Colons are not allowed')
  // `//host/share` is a UNC path once it reaches the file system.
  if (joined.startsWith('/')) throw invalid('UNC and protocol-relative paths are not allowed')
  // An empty segment would make `a//b.jpg` a second spelling of `a/b.jpg`.
  if (segments.some((segment) => segment === '')) throw invalid('Empty path segments are not allowed')
  const normalized = segments.map((segment) => segment.normalize('NFC'))
  // The client's URL parser removes dot segments, so these only come from hand-made URLs.
  if (normalized.some((segment) => segment === '.' || segment === '..')) throw invalid('Dot segments are not allowed')
  const extension = path.extname(normalized.at(-1)!).toLowerCase()
  if (!types.has(extension)) throw invalid('Unsupported file type')
  return {
    segments: normalized,
    canonical: `/${normalized.map((segment) => encodeURIComponent(segment)).join('/')}`,
    extension,
  }
}

/**
 * Parses the raw, still percent-encoded source path after the mount point
 * (`my%20photos/caf%C3%A9.jpg`). Each segment is decoded as UTF-8 on its own,
 * so an encoded slash cannot create a segment. Malformed escapes and the
 * spellings `checkSegments` refuses are a 400.
 */
export function parseSourcePath(raw: string, types: ReadonlySet<string> = RENDER_TYPES): SourcePath {
  const segments = raw.split('/').map((segment) => {
    try {
      return decodeURIComponent(segment)
    } catch {
      throw invalid('Malformed percent-encoding')
    }
  })
  if (segments.some((segment) => segment.includes('/'))) {
    throw invalid(segments.some((s) => s.startsWith('/')) ? 'UNC and protocol-relative paths are not allowed' : 'Encoded slashes are not allowed')
  }
  return checkSegments(segments, types)
}

/** The canonical spelling of the real path of a file inside `rootDir`. */
function canonicalOf(rootDir: string, file: string): string {
  const segments = path.relative(rootDir, file).split(path.sep)
  return `/${segments.map((segment) => encodeURIComponent(segment.normalize('NFC'))).join('/')}`
}

/**
 * Maps parsed segments to a file inside `rootDir`, the root's real path.
 * Missing files and anything that resolves outside the root, symlinks
 * included, are a 404. So is a path that only reaches the file as an alias:
 * another letter case on a case-insensitive file system, a Windows 8.3 short
 * name, or a symlink inside the root. Policy and authorization see the
 * request's canonical path, so it must be the file's own. The real file must
 * have one of `types` too.
 */
export async function openSource(rootDir: string, { segments, canonical }: SourcePath, types: ReadonlySet<string> = RENDER_TYPES): Promise<Source> {
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
  if (!types.has(path.extname(file).toLowerCase())) throw invalid('Unsupported file type')
  // `realpath` returns the names as stored, so any alias spells another path.
  if (canonicalOf(rootDir, file) !== canonical) throw notFound()
  return { file, size: stats.size, mtimeMs: stats.mtimeMs }
}

/**
 * Maps the (already percent-decoded) source path of a request to a file inside
 * `rootDir` (spec 12.1), for the metadata tooling. Malformed paths are a 400;
 * missing files and anything outside the root are a 404.
 */
export async function resolveSource(rootDir: string, src: string | undefined): Promise<Source> {
  if (!src) throw invalid('Missing source path')
  return openSource(rootDir, checkSegments(src.split('/'), RENDER_TYPES))
}
