// Core compiles without DOM or Node types; this is the part of the WHATWG URL used here.
declare const URL: new (
  url: string,
  base?: string,
) => { readonly [part in 'host' | 'hostname' | 'port' | 'protocol' | 'pathname' | 'search' | 'hash' | 'username' | 'password']: string }

// Resolving against this base tells paths (they keep its host) from URLs that
// carry their own host. `.invalid` can never be a real host (RFC 2606).
const HOST = 'lazy-ease.invalid'
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' }

function parse(src: string) {
  try {
    return new URL(src, `http://${HOST}`)
  } catch {
    return undefined
  }
}

/**
 * Whether `src` is served by a lazy-ease backend. Paths are owned. Absolute
 * http(s) URLs are owned when their hostname is in `domains` (exact match,
 * any case; a port in the entry must match too). Protocol-relative URLs,
 * `data:`, `blob:` and every other scheme are external. Query and hash are
 * irrelevant.
 */
export function isOwned(src: string, domains: readonly string[] = []): boolean {
  src = src.trim()
  const url = src ? parse(src) : undefined
  if (!url) return false
  // No scheme: a path keeps the base host; protocol-relative URLs and the
  // `/\host` spellings browsers accept do not.
  if (!/^[a-z][a-z\d+.-]*:/i.test(src)) return url.host === HOST
  const port = DEFAULT_PORTS[url.protocol]
  return (
    !!port &&
    domains.some((entry) => {
      // Going through URL normalizes case, IDNs and IPv6 the same way as `src`.
      const domain = parse(`http://${(entry = entry.trim())}`)
      // URL drops `:80` for http, so an explicit port is read from the entry.
      const explicit = /:(\d+)$/.exec(entry)?.[1]
      return (
        domain?.pathname === '/' &&
        !(domain.search || domain.hash || domain.username || domain.password) &&
        domain.hostname === url.hostname &&
        (explicit === undefined || +explicit === +(url.port || port))
      )
    })
  )
}

/**
 * Whether `src` must load as is instead of through the loader: an external
 * URL, an SVG (by pathname extension or SVG data MIME type) or a GIF, which
 * may be animated. The original keeps its query and fragment.
 */
export function isDirect(src: string, domains?: readonly string[]): boolean {
  if (/^\s*data:image\/(svg\+xml|gif)[;,]/i.test(src)) return true
  if (!isOwned(src, domains)) return true
  return /\.(svg|gif)$/i.test(parse(src.trim())!.pathname)
}
