import { createController, type LazyEase, type LazyEaseConfig } from './dom/controller.js'

export type { AttachOptions, Attachment, LazyEase, LazyEaseConfig, LoadState } from './dom/controller.js'

/**
 * The controller of `@lazy-ease/core` without measured mode, for pages whose
 * images all have prepared (`srcset`, `url`), native or direct sources: a
 * `src` the loader would build URLs for throws. The rest behaves the same.
 */
export function createLazyEase(config: LazyEaseConfig = {}): LazyEase {
  return createController(config, undefined, 'src needs createLazyEase from @lazy-ease/core')
}
