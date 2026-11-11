export { Image, type ImageProps, type ImageSource } from './Image.js'
export {
  LazyEaseProvider,
  useLazyEaseConfig,
  type LazyEaseConfig,
  type LazyEaseProviderProps,
  type LoadingStrategy,
} from './context.js'
// The 0.2 public helpers, now implemented in @lazy-ease/core.
export {
  createLoader,
  DEFAULT_RATIOS,
  DEFAULT_WIDTHS,
  encodePath,
  formatNumber,
  fullLadder,
  snapRatio,
  type FocalPoint,
  type FullLadderOptions,
  type ImageFormat,
  type ImageLoader,
  type ImageLoaderFunction,
  type ImageRequest,
  type LoaderOptions,
  type ResolvedLoader,
} from '@lazy-ease/core'
