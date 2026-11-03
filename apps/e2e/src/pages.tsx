import { Image, LazyEaseProvider } from 'lazy-ease'
import { useEffect, type ReactNode } from 'react'

export interface FixtureImage {
  src: string
  width: number
  height: number
  thumbhash: string
  color: string
}

/** What the server passes to the client, so hydration renders the same tree. */
export interface PageData {
  page: string
  images: {
    photo: FixtureImage
    small: FixtureImage
    /** Copies of the photo under other names, for pages that need several distinct sources. */
    copies: FixtureImage[]
  }
}

declare global {
  interface Window {
    __hydrated?: boolean
  }
}

const CSS = `
  html, body { margin: 0; }
  body { font: 14px/1.4 system-ui, sans-serif; }
  .spacer { height: 2400px; }
  .hero { position: relative; aspect-ratio: 2; }
  .row { display: flex; gap: 16px; padding: 16px; }
  .fluid { padding: 0; }
`

type PageProps = Pick<PageData, 'images'>

function BelowFold({ images: { copies } }: PageProps) {
  return (
    <>
      <div className="spacer" />
      {copies.map((image, i) => (
        <Image
          key={image.src}
          src={image.src}
          alt=""
          width={300}
          height={200}
          srcWidth={image.width}
          wrapperClassName={`below-${i + 1}`}
        />
      ))}
    </>
  )
}

function Dpr({ images: { photo, small } }: PageProps) {
  return (
    <div className="row">
      <Image src={photo.src} alt="" width={300} height={200} srcWidth={photo.width} wrapperClassName="box-300" />
      <Image src={small.src} alt="" width={200} height={150} srcWidth={small.width} wrapperClassName="box-200-src-500" />
    </div>
  )
}

function Resize({ images: { photo } }: PageProps) {
  return (
    <div className="fluid">
      <Image src={photo.src} alt="" aspectRatio={3} srcWidth={photo.width} wrapperClassName="fluid-box" />
    </div>
  )
}

function Placeholders({ images: { photo } }: PageProps) {
  return (
    <div className="row">
      <Image src={photo.src} alt="" width={200} height={150} placeholder="#5b6c8f" wrapperClassName="ph-color" />
      <Image src={photo.src} alt="" width={200} height={150} placeholder={`thumbhash:${photo.thumbhash}`} wrapperClassName="ph-thumbhash" />
      <Image src={photo.src} alt="" width={200} height={150} wrapperClassName="ph-default" />
    </div>
  )
}

function Fade({ images: { photo } }: PageProps) {
  return (
    <div className="row">
      <Image src={photo.src} alt="" width={300} height={200} srcWidth={photo.width} fadeDuration={200} wrapperClassName="fade-box" />
    </div>
  )
}

function Priority({ images: { photo } }: PageProps) {
  return (
    <div className="hero">
      <Image
        src={photo.src}
        alt="Hero"
        fill
        aspectRatio={2}
        sizes="100vw"
        priority
        srcWidth={photo.width}
        placeholder={`thumbhash:${photo.thumbhash}`}
        wrapperClassName="hero-box"
      />
    </div>
  )
}

function FirstViewport({ images: { copies } }: PageProps) {
  const [inView, classic, below] = copies as [FixtureImage, FixtureImage, FixtureImage]
  return (
    <>
      <div className="row">
        <Image src={inView.src} alt="" width={300} height={200} wrapperClassName="in-view" />
        <Image src={classic.src} alt="" width={300} height={200} sizes="300px" wrapperClassName="classic" />
      </div>
      <div className="spacer" />
      <Image src={below.src} alt="" width={300} height={200} wrapperClassName="below" />
    </>
  )
}

export const pages: Record<string, (props: PageProps) => ReactNode> = {
  'below-fold': BelowFold,
  dpr: Dpr,
  resize: Resize,
  placeholder: Placeholders,
  fade: Fade,
  priority: Priority,
  'first-viewport': FirstViewport,
}

function HydrationFlag() {
  useEffect(() => {
    window.__hydrated = true
  }, [])
  return null
}

/** The whole document, rendered by `renderToString` and hydrated with `hydrateRoot(document)`. */
export function Document({ data }: { data: PageData }) {
  const Page = pages[data.page]!
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`lazy-ease e2e: ${data.page}`}</title>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
      </head>
      <body>
        <LazyEaseProvider>
          <Page images={data.images} />
        </LazyEaseProvider>
        <HydrationFlag />
        <script id="data" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />
        <script src="/client.js" defer />
      </body>
    </html>
  )
}
