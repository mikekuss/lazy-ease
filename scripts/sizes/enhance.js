// enhance with its controller.
import { createLazyEase } from '@lazy-ease/core'
import { enhance } from '@lazy-ease/vanilla'
const le = createLazyEase()
export const run = (root) => enhance(le, root)
