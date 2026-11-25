import { createLoader, LazyEaseProvider, type ImageLoader } from '@lazy-ease/react'
import { detectAvif } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as thumbhash from 'thumbhash'
import { ARTICLE, ARTICLE_SIZES, AVATAR, CARD, CELLS, GROW, LOGO, SPLIT, TINY, WAVE, type CatalogSource } from './catalog'
import { DemoImage } from './DemoImage'
import { BASE, STATIC, fadeDuration, pageRun, staticThrottle } from './mode'
import { CARD_SIZE, EXTERNAL_FILE, GALLERY_SIZE, galleryRatio, SINGLE } from './plan'
import { ErrorFallback } from './recipes/ErrorFallback'
import { Banner } from './recipes/Banner'
import { HERO_MAX_WIDTH, HERO_MIN_WIDTH, HeroFrame, heroStartWidth } from './recipes/HeroFrame'
import { Choice, UseCase } from './recipes/UseCase'
import { createStaticLoader } from './staticLoader'

const decoder = thumbhashDecoder(thumbhash)

/** One entry of /api/images: `computeMetadata` plus the path. */
interface SourceImage {
  src: string
  file: string
  width: number
  height: number
  thumbhash: string
  color: string
  revision: string
}

// Written by scripts/build-static.ts in the static build.
const IMAGE_LIST = STATIC ? `${BASE}api/images.json` : '/api/images'
const GALLERY = STATIC ? GALLERY_SIZE.static : GALLERY_SIZE.live
const DENSITIES = [0, 1, 2, 3].map((value) => [value, value ? `${value}×` : 'Device'] as const)

const LOADINGS = [['lazy', 'Lazy'], ['native', 'Native'], ['eager', 'Eager']] as const
type Loading = (typeof LOADINGS)[number][0]
/** Preload distances: 0 px in the demo, so each image visibly loads as it scrolls in; the library's 400 px is marked. */
const PRELOADS = [['0', '0 px'], ['400', '400 px (default)']] as const
type Preload = (typeof PRELOADS)[number][0]
const LAYOUTS = [['fixed', 'Fixed size'], ['ratio', 'Breakpoint ratio'], ['fill', 'Fill'], ['article', 'Article']] as const
type Layout = (typeof LAYOUTS)[number][0]

/**
 * A loader for one replay of one use case. The live server throttles by the
 * top bar's cookie; the static host's service worker reads the parameters.
 * `run` makes every URL new, so a replay starts with a cold browser cache;
 * the server strips it and the throttle parameters again.
 */
function demoLoader(key: string): ImageLoader {
  const params = { ...staticThrottle(), run: `${pageRun()}-${key}` }
  return STATIC ? createStaticLoader({ baseUrl: `${BASE}_img`, params }) : createLoader({ params })
}

/** The provider every React part of the demo page shares: the top bar's reveal speed, ThumbHash placeholders. */
function Provider({ loader, children }: { loader: ImageLoader; children: ReactNode }) {
  return (
    <LazyEaseProvider loader={loader} thumbhash={decoder} detectFormat={detectAvif} fadeDuration={fadeDuration()}>
      {children}
    </LazyEaseProvider>
  )
}

/** The hero use case: the fade or LCP route in a frame of adjustable width. */
export function HeroPanel() {
  const [heroWidth, setHeroWidth] = useState(heroStartWidth)
  return (
    <UseCase
      id="hero"
      title="Hero"
      note="Another crop and focus from 800 px. One fade, never painted in steps."
      controls={
        <label className="field range">
          <span>
            Viewport <output>{heroWidth} px</output>
          </span>
          <input type="range" min={HERO_MIN_WIDTH} max={HERO_MAX_WIDTH} step={10} value={heroWidth} onChange={(e) => setHeroWidth(Number(e.target.value))} />
        </label>
      }
      props="<picture> <source media srcset> <img srcset sizes>  with the placeholder in the HTML"
    >
      {(replay) => <HeroFrame width={heroWidth} route="fade" run={replay} details={false} />}
    </UseCase>
  )
}

/** The use cases in two parts of the page: `main` after the placeholder sections, `more` after the template HTML. */
export function App({ part }: { part: 'main' | 'more' }) {
  const [images, setImages] = useState<SourceImage[]>([])
  const [density, setDensity] = useState<number>(0)
  const [growWidth, setGrowWidth] = useState(240)
  const [showHidden, setShowHidden] = useState(false)
  const [loading, setLoading] = useState<Loading>('lazy')
  const [preload, setPreload] = useState<Preload>('0')
  const [layout, setLayout] = useState<Layout>('fixed')
  // The template section's Replay (static HTML) replays the other sources too.
  const [sourcesReplay, setSourcesReplay] = useState(0)
  useEffect(() => {
    const replay = () => setSourcesReplay((value) => value + 1)
    addEventListener('le-replay-sources', replay)
    return () => removeEventListener('le-replay-sources', replay)
  }, [])

  useEffect(() => {
    // On the first start the server is still generating the images, so retry.
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      fetch(IMAGE_LIST)
        .then((response) => (response.ok ? (response.json() as Promise<SourceImage[]>) : Promise.reject(response.status)))
        .then(setImages)
        .catch(() => {
          timer = setTimeout(load, 2000)
        })
    void load()
    return () => clearTimeout(timer)
  }, [])

  // The cases render once the image list is in; only then can a #case link scroll to its panel.
  const ready = images.length > 0
  useEffect(() => {
    if (ready && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  }, [ready])

  const loader = useMemo(() => demoLoader('page'), [])
  // One loader per use case and replay, kept so a re-render passes the same object.
  const loaders = useMemo(() => new Map<string, ImageLoader>(), [])
  const loaderOf = (id: string, replay: number): ImageLoader => {
    if (replay === 0) return loader
    const key = `${id}-${replay}`
    let own = loaders.get(key)
    if (!own) loaders.set(key, (own = demoLoader(key)))
    return own
  }
  const run = pageRun()

  /** Originals load as they are; a replay changes only their query, which the hosts ignore. */
  const runQuery = (replay: number) => `?run=${run}-${replay}`
  const byPath = useMemo(() => new Map(images.map((image) => [image.src, image])), [images])
  const placeholderFor = (image: SourceImage | undefined) => (image ? `thumbhash:${image.thumbhash}` : '#3b4a3f')
  /** Logical source with trusted dimensions and revision, as a CMS would pass them. */
  const source = ({ src, width, height }: CatalogSource) => ({
    src,
    srcWidth: width,
    srcHeight: height,
    version: STATIC ? undefined : byPath.get(src)?.revision,
    placeholder: placeholderFor(byPath.get(src)),
  })
  // Emulates another density: the browser picks for sizes × its own DPR.
  const sizesFor = (width: number) => (density ? `${Math.round((width * density) / devicePixelRatio)}px` : undefined)
  const gallery = images.filter((image) => !image.file.includes('/'))
  const pick = (i: number) => gallery[i % gallery.length]!
  const external = byPath.get(`/${EXTERNAL_FILE}`)

  const layoutControls = (
    <>
      <Choice label="Layout" value={layout} options={LAYOUTS} onChange={setLayout} />
      {layout === 'fixed' && <Choice label="Density" value={density} options={DENSITIES} onChange={setDensity} />}
      {layout === 'fill' && (
        <label className="field">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden cells
        </label>
      )}
    </>
  )
  const layoutProps = {
    fixed: `<Image width={56} height={56} focalPoint={{ x: 40, y: 30 }}${density ? ` sizes="${sizesFor(AVATAR.size)}"` : ''} />`,
    ratio: '<Image aspectRatio={4 / 3} sources={[{ media, aspectRatio: 2 }]} />   @media (min-width:800px) { [data-le] { --le-ar: 2 } }',
    fill: "<div style={{ position: 'relative' }}><Image fill /></div>",
    article: `<Image loading="native" sizes="${ARTICLE_SIZES}" />`,
  }[layout]
  const layoutNote = {
    fixed: '1× and 2× candidates for a fixed box. A 40 px original gets one URL.',
    ratio: 'One source, 4:3 below 800 px and 2:1 above.',
    fill: 'Cells crop one ladder in the browser. Hidden cells load nothing.',
    article: 'Native, with the ratio from the source size. Without it: one URL.',
  }[layout]

  const main = (
    <>
      <h2 className="group">Behaviour</h2>
      <UseCase
        id="resize"
        title="Resize"
        note="Growing loads a sharper image in place; shrinking keeps the one on screen."
        controls={
          <label className="field range">
            <span>
              Width <output>{growWidth} px</output>
            </span>
            <input type="range" min={120} max={900} step={10} value={growWidth} onChange={(e) => setGrowWidth(Number(e.target.value))} />
          </label>
        }
        props="<Image aspectRatio={1} />"
      >
        {(replay) => (
          <div style={{ width: growWidth, maxWidth: '100%' }}>
            <DemoImage {...source(GROW)} loader={loaderOf('resize', replay)} alt="Peaks" aspectRatio={1} />
          </div>
        )}
      </UseCase>

      <UseCase
        id="errors"
        title="Error fallback"
        note="A source that fails: the box keeps its size, the placeholder goes. Click to try again."
        props={'<Image src="/missing-photo.jpg" alt="…" width={240} height={160} />'}
      >
        {(replay) => <ErrorFallback loader={loaderOf('errors', replay)} />}
      </UseCase>

      <UseCase
        id="gallery"
        title="Scroll gallery"
        note="Each image loads as it comes near the viewport, at the size of its cell."
        controls={
          <>
            <Choice label="Loading" value={loading} options={LOADINGS} onChange={setLoading} />
            {loading === 'lazy' && <Choice label="Preload distance" value={preload} options={PRELOADS} onChange={setPreload} />}
          </>
        }
        props={`<Image aspectRatio={ratio} loading="${loading}"${loading === 'lazy' ? ` rootMargin="${preload}px"` : ''}${loading === 'native' ? ' sizes="…"' : ''} />`}
      >
        {(replay) => (
          <div className="gallery" key={`${loading}-${preload}`}>
            {Array.from({ length: GALLERY }, (_, i) => {
              const [, ratio] = galleryRatio(i, gallery.length)
              return (
                <DemoImage
                  key={i}
                  {...source(pick(i))}
                  loader={loaderOf('gallery', replay)}
                  alt=""
                  aspectRatio={ratio}
                  loading={loading}
                  rootMargin={`${preload}px`}
                  {...(loading === 'native' ? { sizes: '(min-width: 1000px) 33vw, (min-width: 680px) 50vw, 100vw' } : {})}
                />
              )
            })}
          </div>
        )}
      </UseCase>

      <h2 className="group">Layout</h2>
      <HeroPanel />
      <UseCase id="layout" title="Layout modes" note={layoutNote} controls={layoutControls} props={layoutProps}>
        {(replay) => (
          <div key={layout}>
            {layout === 'fixed' && (
              <div className="row" key={density}>
                <DemoImage {...source(AVATAR)} loader={loaderOf('fixed', replay)} alt="Pines" width={AVATAR.size} height={AVATAR.size} focalPoint={AVATAR.focalPoint} sizes={sizesFor(AVATAR.size)} label="56 px" />
                <DemoImage {...source(TINY)} loader={loaderOf('fixed', replay)} alt="Tiny" width={56} height={56} sizes={sizesFor(56)} label="40 px" />
                <DemoImage {...source(CARD)} loader={loaderOf('fixed', replay)} alt="Glacier" {...CARD_SIZE} sizes={sizesFor(CARD_SIZE.width)} label="320×240" />
              </div>
            )}
            {layout === 'ratio' && (
              <div className="split">
                <DemoImage
                  {...source(SPLIT)}
                  loader={loaderOf('ratio', replay)}
                  alt="Ridge"
                  aspectRatio={4 / 3}
                  sizes="100vw"
                  sources={[{ media: '(min-width:800px)', src: SPLIT.src, srcWidth: SPLIT.width, srcHeight: SPLIT.height, aspectRatio: 2, sizes: '50vw', version: source(SPLIT).version }]}
                  label="4:3 or 2:1"
                />
              </div>
            )}
            {layout === 'fill' && (
              <div className="cells">
                {[...CELLS, ...CELLS].map((cell, i) => (
                  <div key={i} hidden={i >= CELLS.length && !showHidden}>
                    <DemoImage {...source(cell)} loader={loaderOf('fill', replay)} alt="" fill frame={{ aspectRatio: '1' }} label={i >= CELLS.length ? 'hidden' : 'cell'} />
                  </div>
                ))}
              </div>
            )}
            {layout === 'article' && (
              <div className="article">
                <DemoImage {...source(ARTICLE)} loader={loaderOf('article', replay)} alt="Night sky" loading="native" sizes={ARTICLE_SIZES} label="native, no layout shift" />
                <DemoImage src={SINGLE.src} loader={loaderOf('article', replay)} alt="Canyon" width={SINGLE.width} height={SINGLE.height} placeholder={placeholderFor(byPath.get(SINGLE.src))} label="one URL" />
              </div>
            )}
          </div>
        )}
      </UseCase>
    </>
  )

  const replay = sourcesReplay
  const more = (
    <div className="more-sources" key={replay}>
      <div className="more-source">
        <Banner loader={loaderOf('background', replay)} />
        <p>CSS background: <code>imageSet()</code>, set once visible</p>
      </div>
      <div className="row">
        <DemoImage src={`${BASE}_img${LOGO}${runQuery(replay)}`} alt="Club" width={120} height={40} label="SVG" />
        <DemoImage src={`${BASE}_img${WAVE}${runQuery(replay)}`} alt="Waving hand" width={64} height={64} label="GIF" />
        {external && (
          <DemoImage
            src={new URL(`${BASE}external/${EXTERNAL_FILE}${runQuery(replay)}`, location.href).href}
            alt="Mountains"
            width={240}
            height={Math.round((240 * external.height) / external.width)}
            placeholder={placeholderFor(external)}
            label="External"
          />
        )}
      </div>
    </div>
  )

  return (
    <Provider loader={loader}>
      {gallery.length === 0 ? (
        <p className="empty">
          {STATIC ? 'Loading the image list …' : 'Loading the image list … is the demo server running on port 3001?'}
        </p>
      ) : (
        <div className="plain">{part === 'main' ? main : more}</div>
      )}
    </Provider>
  )
}
