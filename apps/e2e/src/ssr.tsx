import { renderToString } from 'react-dom/server'
import { Document, type PageData } from './pages.js'

export { pages } from './pages.js'

export function renderPage(data: PageData): string {
  return `<!DOCTYPE html>${renderToString(<Document data={data} />)}`
}
