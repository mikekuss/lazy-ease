import { hydrateRoot } from 'react-dom/client'
import { Document, type PageData } from './pages.js'

const data = JSON.parse(document.getElementById('data')!.textContent!) as PageData
hydrateRoot(document, <Document data={data} />)
