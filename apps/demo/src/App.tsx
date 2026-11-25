import { createLoader, LazyEaseProvider, type ImageLoader } from '@lazy-ease/react'
import { detectAvif, focusReveal } from '@lazy-ease/core'
import { thumbhashDecoder } from '@lazy-ease/core/thumbhash'
import { useEffect, useMemo, useState } from 'react'
import * as thumbhash from 'thumbhash'
import { ARTICLE, ARTICLE_SIZES, AVATAR, CARD, CELLS, GROW, LOGO, SPLIT, TINY, WAVE, type CatalogSource } from './catalog'
import { Controls } from './Controls'
import { DemoImage } from './DemoImage'
import { BASE, STATIC } from './mode'
import { CARD_SIZE, EXTERNAL_FILE, GALLERY_SIZE, galleryRatio, SINGLE } from './plan'
import { Backend } from './recipes/Backend'
import { Banner } from './recipes/Banner'
import { HERO_MAX_WIDTH, HERO_MIN_WIDTH, HeroFrame, heroStartWidth } from './recipes/HeroFrame'
import { shadowLoader, ShadowPanel } from './recipes/ShadowPanel'
import { Choice, UseCase } from './recipes/UseCase'
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
const DENSITIES = [0, 1, 2, 3].map((value) => [value, value ? `${value}×` : 'Device'] as const)

/** The use cases in page order, grouped as in the side list. */
const GROUPS = [
  ['Start', [['hero', 'Hero']]],
  ['Layout', [['fixed', 'Fixed size'], ['ratio', 'Breakpoint ratio'], ['resize', 'Resize'], ['fill', 'Fill'], ['article', 'Article']]],
  ['Sources', [['background', 'Background'], ['originals', 'SVG, GIF, external'], ['shadow', 'Shadow panel'], ['backend', 'Backend']]],
  ['Scrolling', [['gallery', 'Scroll gallery']]],
] as const

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [run, setRun] = useState(0)
  const [images, setImages] = useState<SourceImage[]>([])
  const [density, setDensity] = useState<number>(0)
  const [growWidth, setGrowWidth] = useState(240)
  const [showHidden, setShowHidden] = useState(false)
  const [heroWidth, setHeroWidth] = useState(heroStartWidth)
  const [heroRoute, setHeroRoute] = useState<'lcp' | 'fade'>('lcp')

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

  // The cases render once the image list is in; only then can a #case link scroll to its panel.
  const ready = images.length > 0
  useEffect(() => {
    if (ready && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView()
  }, [ready])

  // `run` makes every URL new, so "Reload all" starts with a cold browser
  // cache, and a use case's replay count does the same for that case. The
  // demo server strips these and the throttle settings again; the static
  // host ignores the query string, and its service worker reads it.
  const throttle = STATIC ? throttleProfile(settings) : throttleParams(settings)
  const makeLoader = (runParam: Record<string, string | number>): ImageLoader =>
    STATIC
      ? createStaticLoader({ baseUrl: `${BASE}_img`, formats: FORMATS[settings.formats] as readonly StaticFormat[], params: { ...throttle, ...runParam } })
      : { ...createLoader({ params: { ...throttle, ...runParam } }), formats: FORMATS[settings.formats] }
  const loader = useMemo(() => makeLoader(run > 0 ? { run } : {}), [settings, run])
  // One loader per use case and replay, kept so a re-render passes the same object.
  const loaders = useMemo(() => new Map<string, ImageLoader>(), [settings, run])
  const loaderOf = (id: string, replay: number): ImageLoader => {
    if (replay === 0) return loader
    const key = `${id}-${replay}`
    let own = loaders.get(key)
    if (!own) loaders.set(key, (own = id === 'shadow' ? shadowLoader({ ...throttle, run: `${run}-${key}` }) : makeLoader({ run: `${run}-${key}` })))
    return own
  }
  const panelLoader = useMemo(() => shadowLoader({ ...throttle, ...(run > 0 ? { run } : {}) }), [settings, run])
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

  /** Originals load as they are; a replay changes only their query, which the hosts ignore. */
  const runQuery = (replay: number) => (replay > 0 || run > 0 ? `?run=${run}-${replay}` : '')
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
      fadeDuration={settings.reveal === 'none' ? 0 : settings.fadeDuration}
      reveal={settings.reveal === 'focus' ? focusReveal : undefined}
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
        <div className={settings.details ? 'recipes' : 'recipes plain'}>
          <nav className="side" aria-label="Use cases">
            {GROUPS.map(([group, cases]) => (
              <div key={group}>
                <h2>{group}</h2>
                {cases.map(([id, title]) => (
                  <a key={id} href={`#${id}`}>
                    {title}
                  </a>
                ))}
              </div>
            ))}
          </nav>

          <main key={demoKey}>
            {/* The side list's stand-in on narrow screens. */}
            <nav className="chips" aria-label="Use cases">
              {GROUPS.flatMap(([, cases]) =>
                cases.map(([id, title]) => (
                  <a key={id} href={`#${id}`}>
                    {title}
                  </a>
                )),
              )}
            </nav>
            <h2 className="group">Start</h2>
            <UseCase
              id="hero"
              title="Hero"
              note="Art direction from 800 px. The route runs with its own settings."
              // The LCP route's sources are in its HTML: loading it again only hits the cache.
              replayable={heroRoute === 'fade'}
              controls={
                <>
                  <Choice label="Route" value={heroRoute} options={[['lcp', 'LCP'], ['fade', 'Fade']]} onChange={setHeroRoute} />
                  <label className="field range">
                    <span>
                      Viewport <output>{heroWidth} px</output>
                    </span>
                    <input type="range" min={HERO_MIN_WIDTH} max={HERO_MAX_WIDTH} step={10} value={heroWidth} onChange={(e) => setHeroWidth(Number(e.target.value))} />
                  </label>
                </>
              }
              props={heroRoute === 'lcp' ? '<img srcset sizes fetchpriority="high">  in the first HTML' : '<span data-le> <img data-le-srcset data-le-sizes>'}
            >
              {(replay) => <HeroFrame width={heroWidth} route={heroRoute} run={replay} details={settings.details} />}
            </UseCase>

            <h2 className="group">Layout</h2>
            <UseCase
              id="fixed"
              title="Fixed size"
              note="1× and 2× candidates. A 40 px original gets one URL."
              controls={<Choice label="Density" value={density} options={DENSITIES} onChange={setDensity} />}
              props={`<Image width={56} height={56} focalPoint={{ x: 40, y: 30 }}${density ? ` sizes="${sizesFor(AVATAR.size)}"` : ''} />`}
            >
              {(replay) => (
                <div className="row" key={density}>
                  <DemoImage {...source(AVATAR)} loader={loaderOf('fixed', replay)} alt="Pines" width={AVATAR.size} height={AVATAR.size} focalPoint={AVATAR.focalPoint} sizes={sizesFor(AVATAR.size)} label="56 px" />
                  <DemoImage {...source(TINY)} loader={loaderOf('fixed', replay)} alt="Tiny" width={56} height={56} sizes={sizesFor(56)} label="40 px" />
                  <DemoImage {...source(CARD)} loader={loaderOf('fixed', replay)} alt="Glacier" {...CARD_SIZE} sizes={sizesFor(CARD_SIZE.width)} label="320×240" />
                </div>
              )}
            </UseCase>

            <UseCase id="ratio" title="Breakpoint ratio" note="4:3 below 800 px, 2:1 above." props="<Image aspectRatio={4 / 3} sources={[{ media, aspectRatio: 2 }]} />">
              {(replay) => (
                <div className="split">
                  <DemoImage
                    {...source(SPLIT)}
                    loader={loaderOf('ratio', replay)}
                    alt="Ridge"
                    aspectRatio={4 / 3}
                    sizes="100vw"
                    sources={[{ media: '(min-width:800px)', src: SPLIT.src, srcWidth: SPLIT.width, srcHeight: SPLIT.height, aspectRatio: 2, sizes: '50vw', version: source(SPLIT).version }]}
                    label="card"
                  />
                </div>
              )}
            </UseCase>

            <UseCase
              id="resize"
              title="Resize"
              note="Growing upgrades in place, shrinking keeps the image."
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
                  <DemoImage {...source(GROW)} loader={loaderOf('resize', replay)} alt="Peaks" aspectRatio={1} label="measured" />
                </div>
              )}
            </UseCase>

            <UseCase
              id="fill"
              title="Fill"
              note="Browser crop of one ladder. Hidden cells stay idle."
              controls={
                <label className="field">
                  <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden cells
                </label>
              }
              props="<div style={{ position: 'relative' }}><Image fill /></div>"
            >
              {(replay) => (
                <div className="cells">
                  {[...CELLS, ...CELLS].map((cell, i) => (
                    <div key={i} hidden={i >= CELLS.length && !showHidden}>
                      <DemoImage {...source(cell)} loader={loaderOf('fill', replay)} alt="" fill frame={{ aspectRatio: '1' }} label={i >= CELLS.length ? 'hidden' : 'cell'} />
                    </div>
                  ))}
                </div>
              )}
            </UseCase>

            <UseCase id="article" title="Article" note="Native with intrinsic ratio. Without source size: one URL." props={`<Image loading="native" sizes="${ARTICLE_SIZES}" />`}>
              {(replay) => (
                <div className="article">
                  <DemoImage {...source(ARTICLE)} loader={loaderOf('article', replay)} alt="Night sky" loading="native" sizes={ARTICLE_SIZES} label="native" />
                  <DemoImage src={SINGLE.src} loader={loaderOf('article', replay)} alt="Canyon" width={SINGLE.width} height={SINGLE.height} placeholder={placeholderFor(byPath.get(SINGLE.src))} label="one URL" />
                </div>
              )}
            </UseCase>

            <h2 className="group">Sources</h2>
            <UseCase id="background" title="Background" note="CSS image-set(), set once visible." props="--banner: imageSet({ src, width: 720, aspectRatio: 2, loader })">
              {(replay) => <Banner loader={loaderOf('background', replay)} />}
            </UseCase>

            <UseCase id="originals" title="SVG, GIF, external" note="Loaded as they are." props={'<Image src="logo.svg" width={120} height={40} />'}>
              {(replay) => (
                <div className="row">
                  <DemoImage src={`${BASE}_img${LOGO}${runQuery(replay)}`} alt="Club" width={120} height={40} label="SVG" />
                  <DemoImage src={`${BASE}_img${WAVE}${runQuery(replay)}`} alt="Waving hand" width={64} height={64} label="GIF" />
                  {external && (
                    <DemoImage
                      src={new URL(`${BASE}external/${EXTERNAL_FILE}${runQuery(replay)}`, location.href).href}
                      alt="Mountains"
                      width={320}
                      height={Math.round((320 * external.height) / external.width)}
                      placeholder={placeholderFor(external)}
                      label="external"
                    />
                  )}
                </div>
              )}
            </UseCase>

            <UseCase id="shadow" title="Shadow panel" note="Own CSS and controller, the panel scrolls." props="createLazyEase({ loader, root: panel }).attach(img, { src, token })">
              {(replay) => <ShadowPanel loader={replay ? loaderOf('shadow', replay) : panelLoader} />}
            </UseCase>

            <UseCase id="backend" title="Backend" note={STATIC ? 'Live server only.' : 'Denied crop, cache hit, eviction.'} props="createImageApp({ root, storage, policy })" replayable={!STATIC}>
              {() => (STATIC ? null : <Backend />)}
            </UseCase>
            <h2 className="group">Scrolling</h2>
            <UseCase id="gallery" title="Scroll gallery" note={settings.details ? 'Lazy as you scroll. Crossed out: what sizes="100vw" would load.' : 'Lazy as you scroll.'} props="<Image aspectRatio={ratio} />">
              {(replay) => (
                <div className="gallery">
                  {Array.from({ length: GALLERY }, (_, i) => {
                    const [label, ratio] = galleryRatio(i, gallery.length)
                    return (
                      <DemoImage
                        key={i}
                        {...source(pick(i))}
                        loader={loaderOf('gallery', replay)}
                        alt=""
                        aspectRatio={ratio}
                        compare={settings.details}
                        {...(settings.loading === 'native' ? { sizes: '(min-width: 1000px) 33vw, (min-width: 680px) 50vw, 100vw' } : {})}
                        label={`#${i + 1} · ${label}`}
                      />
                    )
                  })}
                </div>
              )}
            </UseCase>
          </main>
        </div>
      )}
    </LazyEaseProvider>
  )
}
