export interface ValidatedProps {
  fill?: boolean
  width?: number
  height?: number
  aspectRatio?: number
  sizes?: string
  priority?: boolean
  loading?: string
  crop?: 'server' | 'browser'
  srcWidth?: number
  srcHeight?: number
}

/** The first invalid prop combination, or undefined. Development only. */
export function invalidCombination({ fill, width, height, aspectRatio, sizes, priority, loading, crop, srcWidth, srcHeight }: ValidatedProps): string | undefined {
  if (height !== undefined && width === undefined) return '`height` requires `width`.'
  if (fill && (width !== undefined || height !== undefined)) return '`fill` cannot be combined with `width` or `height`.'
  if (width !== undefined && height !== undefined && aspectRatio !== undefined) {
    return '`width`, `height` and `aspectRatio` cannot be used together. Drop one of them.'
  }
  if (crop === 'browser' && !(srcWidth && srcHeight)) return '`crop="browser"` requires `srcWidth` and `srcHeight`.'
  if ((priority || loading === 'native') && width === undefined && sizes === undefined) {
    return `\`${priority ? 'priority' : 'loading="native"'}\` requires \`width\` or \`sizes\`, because its URLs are built before anything can be measured.`
  }
  return undefined
}
