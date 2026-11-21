import { createLoader, LazyEaseProvider, type ImageLoader } from '@lazy-ease/react'
import { detectAvif } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as thumbhash from 'thumbhash'
import { ARTICLE, ARTICLE_SIZES, AVATAR, CARD, CELLS, GROW, LOGO, SPLIT, TINY, WAVE, type CatalogSource } from './catalog'
import { Controls } from './Controls'
import { DemoImage } from './DemoImage'
import { BASE, STATIC } from './mode'
import { CARD_SIZE, EXTERNAL_FILE, GALLERY_SIZE, galleryRatio, SINGLE } from './plan'
import { Backend } from './recipes/Backend'
import { Banner } from './recipes/Banner'
import { HeroFrame } from './recipes/HeroFrame'
import { shadowLoader, ShadowPanel } from './recipes/ShadowPanel'
import { FORMATS, loadSettings, saveSettings, throttleParams, throttleProfile, type Settings } from './settings'
import { createStaticLoader, type StaticFormat } from './staticLoader'

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
const DENSITIES = [0, 1, 2, 3]

function Case({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {note && <p>{note}</p>}
      {children}
    </section>
  )
}

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [run, setRun] = useState(0)
  const [images, setImages] = useState<SourceImage[]>([])
  const [density, setDensity] = useState(0)
  const [growWidth, setGrowWidth] = useState(240)
  const [showHidden, setShowHidden] = useState(false)

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

  useEffect(() => saveSettings(settings), [settings])

  // `run` makes every URL new, so "Reload images" starts with a cold browser
  // cache. The demo server strips it and the throttle settings again; the
  // static host ignores the query string, and its service worker reads it.
  const loader = useMemo<ImageLoader>(() => {
    const runParam: Record<string, number> = run > 0 ? { run } : {}
    if (STATIC) {
      return createStaticLoader({
        baseUrl: `${BASE}_img`,
        formats: FORMATS[settings.formats] as readonly StaticFormat[],
        params: { ...throttleProfile(settings), ...runParam },
      })
    }
    return {
      ...createLoader({ params: { ...throttleParams(settings), ...runParam } }),
      formats: FORMATS[settings.formats],
    }
  }, [settings, run])
  const panelLoader = useMemo(() => {
    const runParam: Record<string, number> = run > 0 ? { run } : {}
    return shadowLoader({ ...(STATIC ? throttleProfile(settings) : throttleParams(settings)), ...runParam })
  }, [settings, run])
  // Any change restarts the demo so you can watch it from a clean state.
  const demoKey = `${run}-${JSON.stringify(settings)}`
  const changeSettings = (next: Settings) => {
    performance.clearResourceTimings()
    setSettings(next)
  }
  const reload = () => {
    performance.clearResourceTimings()
    window.scrollTo({ top: 0 })
    setRun((value) => value + 1)
  }

  const byPath = useMemo(() => new Map(images.map((image) => [image.src, image])), [images])
  const placeholderFor = (image: SourceImage | undefined) =>
    !image
      ? '#3b4a3f'
      : settings.placeholder === 'thumbhash'
        ? `thumbhash:${image.thumbhash}`
        : settings.placeholder === 'color'
          ? image.color
          : 'none'
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

  return (
    <LazyEaseProvider
      loader={loader}
      thumbhash={decoder}
      detectFormat={detectAvif}
      loading={settings.loading}
      rootMargin={`${settings.rootMargin}px`}
      dwellTime={settings.dwellTime}
      fadeDuration={settings.fadeDuration}
    >
      <header className="topbar">
        <div className="brand">
          <strong>lazy-ease</strong>
          <span>Recipes</span>
          <a href={`${BASE}fade/`}>Fade hero</a>
          <a href={`${BASE}lcp/`}>LCP hero</a>
          {/* The controller cases need the demo server, so the static build has none. */}
          {!STATIC && <a href="/controller.html">Controller cases</a>}
        </div>
        <Controls settings={settings} onChange={changeSettings} onReload={reload} />
      </header>
      {STATIC && (
        <p className="static-banner">
          Static demo: pre-rendered variants. Run <code>pnpm dev</code> for the live server.
        </p>
      )}

      {gallery.length === 0 ? (
        <p className="empty">
          {STATIC ? 'Loading the image list …' : 'Loading the image list … is the demo server running on port 3001?'}
        </p>
      ) : (
        <main key={demoKey}>
          <Case title="Hero" note="Drag past 800 px: wide crop and focus switch.">
            <HeroFrame />
          </Case>

          <Case title="Fixed and DPR" note="1× and 2× candidates. A 40 px original gets one URL.">
            <div className="inline-controls">
              <label className="field">
                <span>Density</span>
                <select value={density} onChange={(e) => setDensity(Number(e.target.value))}>
                  {DENSITIES.map((value) => (
                    <option key={value} value={value}>
                      {value ? `${value}× (via sizes)` : `Device (${devicePixelRatio}×)`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="row" key={density}>
              <DemoImage {...source(AVATAR)} alt="Pines" width={AVATAR.size} height={AVATAR.size} focalPoint={AVATAR.focalPoint} sizes={sizesFor(AVATAR.size)} label="56 px" />
              <DemoImage {...source(TINY)} alt="Tiny" width={56} height={56} sizes={sizesFor(56)} label="40 px original" />
              <DemoImage {...source(CARD)} alt="Glacier" {...CARD_SIZE} sizes={sizesFor(CARD_SIZE.width)} label="320×240" />
            </div>
          </Case>

          <Case title="Breakpoint ratio" note="4:3 below 800 px, 2:1 above.">
            <div className="split">
              <DemoImage
                {...source(SPLIT)}
                alt="Ridge"
                aspectRatio={4 / 3}
                sizes="100vw"
                sources={[{ media: '(min-width:800px)', src: SPLIT.src, srcWidth: SPLIT.width, srcHeight: SPLIT.height, aspectRatio: 2, sizes: '50vw', version: source(SPLIT).version }]}
                label="card"
              />
            </div>
          </Case>

          <Case title="Resize" note="Growing upgrades in place, shrinking keeps the image.">
            <div className="inline-controls">
              <label className="field range">
                <span>
                  Width <output>{growWidth} px</output>
                </span>
                <input type="range" min={120} max={900} step={10} value={growWidth} onChange={(e) => setGrowWidth(Number(e.target.value))} />
              </label>
            </div>
            <div style={{ width: growWidth, maxWidth: '100%' }}>
              <DemoImage {...source(GROW)} alt="Peaks" aspectRatio={1} label="measured" />
            </div>
          </Case>

          <Case title="Fill gallery" note="Browser crop of one uncropped ladder. Hidden cells stay idle.">
            <label className="field checkbox">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden cells
            </label>
            <div className="cells">
              {[...CELLS, ...CELLS].map((cell, i) => (
                <div key={i} hidden={i >= CELLS.length && !showHidden}>
                  <DemoImage {...source(cell)} alt="" fill frame={{ aspectRatio: '1' }} label={i >= CELLS.length ? 'hidden' : 'cell'} />
                </div>
              ))}
            </div>
          </Case>

          <Case title="Article" note="Native, intrinsic ratio. Without source size: one URL.">
            <div className="article">
              <DemoImage {...source(ARTICLE)} alt="Night sky" loading="native" sizes={ARTICLE_SIZES} label="native" />
              <DemoImage src={SINGLE.src} alt="Canyon" width={SINGLE.width} height={SINGLE.height} placeholder={placeholderFor(byPath.get(SINGLE.src))} label="one URL" />
            </div>
          </Case>

          <Case title="Background" note="CSS image-set(), set once visible.">
            <Banner loader={loader} />
          </Case>

          <Case title="Originals" note="SVG, animated GIF and an external photo load as they are.">
            <div className="row">
              <DemoImage src={`${BASE}_img${LOGO}`} alt="Club" width={120} height={40} label="SVG" />
              <DemoImage src={`${BASE}_img${WAVE}`} alt="Waving hand" width={64} height={64} label="GIF" />
              {external && (
                <DemoImage
                  src={new URL(`${BASE}external/${EXTERNAL_FILE}`, location.href).href}
                  alt="Mountains"
                  width={320}
                  height={Math.round((320 * external.height) / external.width)}
                  placeholder={placeholderFor(external)}
                  label="external"
                />
              )}
            </div>
          </Case>

          <Case title="Shadow panel" note="Own CSS and controller, the panel is the scroll root.">
            <ShadowPanel loader={panelLoader} />
          </Case>

          <Case title="Backend" note={STATIC ? 'Live server only.' : 'Denied crop, cache hit, eviction and the render after it.'}>
            {!STATIC && <Backend />}
          </Case>

          <Case title="Scroll gallery">
            <div className="gallery">
              {Array.from({ length: GALLERY }, (_, i) => {
                const [label, ratio] = galleryRatio(i, gallery.length)
                const image = pick(i)
                return (
                  <DemoImage
                    key={i}
                    {...source(image)}
                    alt=""
                    aspectRatio={ratio}
                    compare
                    {...(settings.loading === 'native' ? { sizes: '(min-width: 1000px) 33vw, (min-width: 680px) 50vw, 100vw' } : {})}
                    label={`#${i + 1} · ${label}`}
                  />
                )
              })}
            </div>
          </Case>
        </main>
      )}
    </LazyEaseProvider>
  )
}
