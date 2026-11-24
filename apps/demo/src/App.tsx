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

function Case({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="case" id={id}>
      <h2>
        {title}
        {note && <small>{note}</small>}
      </h2>
      {children}
    </section>
  )
}

/** The props a case passes, as the JSX writes them. */
const Props = ({ children }: { children: string }) => <code className="props">{children}</code>

/** One button per variant; only the chosen one is rendered. */
function Tabs<T extends string>({ value, options, onChange }: { value: T; options: Record<T, string>; onChange: (value: T) => void }) {
  return (
    <div className="tabs" role="group">
      {(Object.entries(options) as [T, string][]).map(([key, label]) => (
        <button key={key} type="button" aria-pressed={key === value} onClick={() => onChange(key)}>
          {label}
        </button>
      ))}
    </div>
  )
}

const LAYOUTS = { fixed: 'Fixed', ratio: 'Breakpoint ratio', resize: 'Resize', fill: 'Fill', article: 'Article' } as const
const SOURCES = { background: 'Background', originals: 'SVG, GIF, external', shadow: 'Shadow panel', backend: 'Backend' } as const

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [run, setRun] = useState(0)
  const [images, setImages] = useState<SourceImage[]>([])
  const [density, setDensity] = useState(0)
  const [growWidth, setGrowWidth] = useState(240)
  const [showHidden, setShowHidden] = useState(false)
  const [layout, setLayout] = useState<keyof typeof LAYOUTS>('fixed')
  const [kind, setKind] = useState<keyof typeof SOURCES>('background')

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

  const provider = `<LazyEaseProvider loading="${settings.loading}" rootMargin="${settings.rootMargin}px" dwellTime={${settings.dwellTime}} fadeDuration={${settings.fadeDuration}}>`
  const placeholderProp = { thumbhash: 'placeholder="thumbhash:…"', color: 'placeholder="#rrggbb"', none: 'placeholder="none"' }[settings.placeholder]

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
      <Controls settings={settings} onChange={changeSettings} onReload={reload} />
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
        <main className="page" key={demoKey}>
          <nav className="toc" aria-label="Cases">
            <a href="#hero">Hero</a>
            <a href="#layout">Layout</a>
            <a href="#sources">Sources</a>
            <a href="#gallery">Gallery</a>
          </nav>
          <Props>{`${provider}\n  <Image src srcWidth srcHeight version ${placeholderProp} … />`}</Props>

          <Case id="hero" title="Hero" note="Drag past 800 px: wide crop and focus switch.">
            <HeroFrame />
          </Case>

          <Case id="layout" title="Layout" note="How the box gets its size.">
            <Tabs value={layout} options={LAYOUTS} onChange={setLayout} />
            {layout === 'fixed' && (
              <>
                <p className="note">1× and 2× candidates. A 40 px original gets one URL.</p>
                <Props>{`<Image width={56} height={56} focalPoint={{ x: 40, y: 30 }} />\n<Image width={320} height={240} />`}</Props>
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
              </>
            )}
            {layout === 'ratio' && (
              <>
                <p className="note">4:3 below 800 px, 2:1 above.</p>
                <Props>{`<Image aspectRatio={4 / 3} sizes="100vw"\n  sources={[{ media: '(min-width:800px)', aspectRatio: 2, sizes: '50vw' }]} />`}</Props>
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
              </>
            )}
            {layout === 'resize' && (
              <>
                <p className="note">Measured: growing upgrades in place, shrinking keeps the image.</p>
                <Props>{`<Image aspectRatio={1} />`}</Props>
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
              </>
            )}
            {layout === 'fill' && (
              <>
                <p className="note">Browser crop of one uncropped ladder. Hidden cells stay idle.</p>
                <Props>{`<div style={{ position: 'relative', aspectRatio: '1' }}>\n  <Image fill />\n</div>`}</Props>
                <div className="inline-controls">
                  <label className="field">
                    <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden cells
                  </label>
                </div>
                <div className="cells">
                  {[...CELLS, ...CELLS].map((cell, i) => (
                    <div key={i} hidden={i >= CELLS.length && !showHidden}>
                      <DemoImage {...source(cell)} alt="" fill frame={{ aspectRatio: '1' }} label={i >= CELLS.length ? 'hidden' : 'cell'} />
                    </div>
                  ))}
                </div>
              </>
            )}
            {layout === 'article' && (
              <>
                <p className="note">Native, intrinsic ratio. Without source size: one URL.</p>
                <Props>{`<Image loading="native" sizes="${ARTICLE_SIZES}" />\n<Image width={320} height={480} />  // no srcWidth`}</Props>
                <div className="article">
                  <DemoImage {...source(ARTICLE)} alt="Night sky" loading="native" sizes={ARTICLE_SIZES} label="native" />
                  <DemoImage src={SINGLE.src} alt="Canyon" width={SINGLE.width} height={SINGLE.height} placeholder={placeholderFor(byPath.get(SINGLE.src))} label="one URL" />
                </div>
              </>
            )}
          </Case>

          <Case id="sources" title="Sources" note="Beyond the plain <Image>.">
            <Tabs value={kind} options={SOURCES} onChange={setKind} />
            {kind === 'background' && (
              <>
                <p className="note">CSS image-set(), set once visible.</p>
                <Props>{`--banner: imageSet({ src, width: 720, aspectRatio: 2, loader })\nwhenVisible(banner, …, () => banner.setAttribute('data-le-visible', ''))`}</Props>
                <Banner loader={loader} />
              </>
            )}
            {kind === 'originals' && (
              <>
                <p className="note">SVG, animated GIF and an external photo load as they are.</p>
                <Props>{`<Image src="/_img/extra/logo.svg" width={120} height={40} />\n<Image src="https://…/mountains.jpg" width={320} height={213} />`}</Props>
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
              </>
            )}
            {kind === 'shadow' && (
              <>
                <p className="note">Own CSS and controller, the panel is the scroll root.</p>
                <Props>{`createLazyEase({ loader, root: panel })\n  .attach(img, { src, width: 128, height: 128, token, version })`}</Props>
                <ShadowPanel loader={panelLoader} />
              </>
            )}
            {kind === 'backend' && (
              <>
                <p className="note">{STATIC ? 'Live server only.' : 'Denied crop, cache hit, eviction and the render after it.'}</p>
                {!STATIC && <Backend />}
              </>
            )}
          </Case>

          <Case id="gallery" title="Scroll gallery" note={'Crossed out: what sizes="100vw" would load.'}>
            <Props>{`<Image aspectRatio={ratio} />`}</Props>
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
