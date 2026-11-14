// attach with controller creation.
import { createLazyEase } from '@lazy-ease/core'
const le = createLazyEase()
export const attach = (img, options) => le.attach(img, options)
