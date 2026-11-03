/**
 * A 1×1 SVG in a single color as a data URI. Small enough to inline on every
 * image, e.g. with the dominant color stored next to the image in your CMS.
 */
export function colorPlaceholder(color: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="${color}"/></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
