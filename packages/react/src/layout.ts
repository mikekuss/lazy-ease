import type { CSSProperties } from 'react'

export type LayoutMode = 'fill' | 'fixed' | 'ratio' | 'intrinsic'

export interface LayoutProps {
  fill?: boolean
  width?: number
  height?: number
  aspectRatio?: number
}

export interface Layout {
  mode: LayoutMode
  /** Box CSS from the spec 5.2 table. */
  boxStyle: CSSProperties
  /** Style for the `<img>`, before fade and the `style` prop. */
  imgStyle: CSSProperties
  /**
   * The crop ratio declared by the props, not yet snapped. Undefined in
   * intrinsic mode and in fill mode without `aspectRatio`, where the measured
   * box ratio is used instead.
   */
  declaredRatio?: number
  /** `width`/`height` attributes for the `<img>`, when known. */
  imgWidth?: number
  imgHeight?: number
}

const COVER: CSSProperties = { display: 'block', width: '100%', height: '100%', objectFit: 'cover' }

/** The layout mode, by the precedence of spec 5.2: fill, fixed, ratio, intrinsic. */
export function resolveLayout({ fill, width, height, aspectRatio }: LayoutProps): Layout {
  if (fill) {
    return {
      mode: 'fill',
      boxStyle: { display: 'block', position: 'absolute', inset: 0 },
      imgStyle: COVER,
      declaredRatio: aspectRatio,
    }
  }
  if (width !== undefined && height !== undefined) {
    return {
      mode: 'fixed',
      // `position: relative` only anchors the <noscript> fallback image.
      boxStyle: { display: 'block', position: 'relative', width, maxWidth: '100%', aspectRatio: `${width} / ${height}` },
      imgStyle: COVER,
      declaredRatio: width / height,
      imgWidth: width,
      imgHeight: height,
    }
  }
  if (aspectRatio !== undefined) {
    return {
      mode: 'ratio',
      boxStyle: { display: 'block', position: 'relative', width: width ?? '100%', aspectRatio },
      imgStyle: COVER,
      declaredRatio: aspectRatio,
      imgWidth: width,
      imgHeight: width === undefined ? undefined : Math.round(width / aspectRatio),
    }
  }
  return {
    mode: 'intrinsic',
    boxStyle: { display: 'block', width: width ?? '100%' },
    imgStyle: { display: 'block', width: '100%', height: 'auto' },
    imgWidth: width,
  }
}

export interface ValidatedProps extends LayoutProps {
  sizes?: string
  priority?: boolean
  loading?: string
}

/** The first invalid prop combination from spec 5.2, or undefined. */
export function invalidCombination({ fill, width, height, aspectRatio, sizes, priority, loading }: ValidatedProps): string | undefined {
  if (height !== undefined && width === undefined) return '`height` requires `width`.'
  if (fill && (width !== undefined || height !== undefined)) return '`fill` cannot be combined with `width` or `height`.'
  if (width !== undefined && height !== undefined && aspectRatio !== undefined) {
    return '`width`, `height` and `aspectRatio` cannot be used together. Drop one of them.'
  }
  if ((priority || loading === 'native') && width === undefined && sizes === undefined) {
    return `\`${priority ? 'priority' : 'loading="native"'}\` requires \`width\` or \`sizes\`, because its URLs are built before anything can be measured.`
  }
  return undefined
}
