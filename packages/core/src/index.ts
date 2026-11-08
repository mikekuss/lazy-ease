// The export order sets the module order in a bundle, which moves the Brotli
// size of the React Image by tens of bytes (esbuild 0.28.2, ES2022, Brotli
// 11). This order was the smallest of all 5040 measured.
export {
  DEFAULT_WIDTHS,
  classicCandidates,
  fullLadder,
  measuredCandidates,
  snapWidth,
  type ClassicCandidatesOptions,
  type FullLadderOptions,
  type MeasuredCandidatesOptions,
} from './widths.js'
export { formatNumber } from './numbers.js'
export { DEFAULT_RATIOS, snapRatio } from './ratios.js'
export {
  coverPosition,
  cropWindow,
  focusInWindow,
  normalizeFocalPoint,
  percentPosition,
  type CropWindow,
  type FocalPoint,
} from './focal.js'
export { buildSrcSet, type SrcSetOptions } from './srcset.js'
export {
  createLoader,
  encodePath,
  normalizeLoader,
  snapQuality,
  type ImageFormat,
  type ImageLoader,
  type ImageLoaderFunction,
  type ImageRequest,
  type LoaderOptions,
  type ResolvedLoader,
} from './loader.js'
export { outputSize, type OutputRequest, type OutputSize } from './output.js'
// New in 0.3. Appended last: their modules come after the ones above in a
// bundle, so they leave the React Image size alone.
export { candidateSet, type CandidateSet, type CandidateSetOptions } from './candidates.js'
export { isDirect, isOwned } from './source.js'
export { focusStyles, parsePlaceholder, type FocusStyleOptions, type FocusStyles, type Placeholder, type StyleRecord, type ThumbHashDecoder } from './styles.js'
export { whenVisible, type WhenVisibleOptions } from './dom/observe.js'
export {
  createLazyEase,
  type AttachOptions,
  type Attachment,
  type LazyEase,
  type LazyEaseConfig,
  type LoadState,
} from './dom/controller.js'
