/**
 * No-JS fallbacks: a hard swap needs no box of its own, intrinsic reserves the source ratio.
 * No imports, so tests can load it without the package build.
 */
export const NO_SCRIPT = {
  'hard-swap': { width: 320, height: 240, fadeDuration: 0 },
  'hard-swap-prepared': { width: 320, height: 240, sizes: '320px', fadeDuration: 0 },
  intrinsic: { width: 320, fadeDuration: 0 },
  'intrinsic-fade': { width: 320 },
  fade: { width: 320, height: 240 },
}
