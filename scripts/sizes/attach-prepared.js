// attach with the controller without measured mode.
import { createLazyEase } from '@lazy-ease/core/prepared'
const le = createLazyEase()
export const attach = (img, options) => le.attach(img, options)
