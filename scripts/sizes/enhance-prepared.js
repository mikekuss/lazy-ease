// enhance with the controller without measured mode.
import { createLazyEase } from '@lazy-ease/core/prepared'
import { enhance } from '@lazy-ease/vanilla'
const le = createLazyEase()
export const run = (root) => enhance(le, root)
