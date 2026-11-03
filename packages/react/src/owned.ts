// Resolving against this base tells paths (they keep its host) from URLs that
// carry their own host. `.invalid` can never be a real host (RFC 2606).
const DUMMY_BASE = new URL('http://lazy-ease.invalid')

const SCHEME = /^[a-z][a-z\d+\-.]*:/i
const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' }

interface Domain {
  hostname: string
  port?: string
}

function parseDomain(domain: string): Domain | undefined {
  try {
    // Going through URL normalizes case, IDNs and IPv6 the same way as `src`.
    const url = new URL(`http://${domain.trim()}`)
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return undefined
    // URL drops `:80` for http, so read an explicit port from the input.
    const port = /:(\d+)$/.exec(domain.trim())?.[1]
    return { hostname: url.hostname, port: port === undefined ? undefined : String(Number(port)) }
  } catch {
    return undefined
  }
}

/**
 * Whether `src` is served by a lazy-ease backend (spec 10). Paths are owned.
 * Absolute http(s) URLs are owned when their hostname is in `domains` (exact
 * match, any case; a port in the entry must match too). Protocol-relative,
 * `data:`, `blob:` and every other scheme are external. Query and hash are
 * irrelevant.
 */
export function isOwned(src: string, domains: readonly string[] = []): boolean {
  if (src.trim() === '') return false
  let url: URL
  try {
    url = new URL(src, DUMMY_BASE)
  } catch {
    return false
  }

  if (!SCHEME.test(src.trim())) {
    // No scheme: a path stays on the dummy host. Anything else was
    // protocol-relative, including `/\host` spellings browsers accept.
    return url.host === DUMMY_BASE.host
  }

  const defaultPort = DEFAULT_PORTS[url.protocol]
  if (defaultPort === undefined) return false
  const port = url.port || defaultPort
  return domains.some((entry) => {
    const domain = parseDomain(entry)
    return domain !== undefined && domain.hostname === url.hostname && (domain.port === undefined || domain.port === port)
  })
}
