import { createLoader, LazyEaseProvider, type ImageLoader } from '@lazy-ease/react'
import { useEffect, useMemo, useState } from 'react'
import { Controls } from './Controls'
import { DemoImage } from './DemoImage'
import { BASE, STATIC } from './mode'
import { EXTERNAL_IMAGE, FILL, FIXED_SIZES, GALLERY_SIZE, galleryRatio, HERO_RATIO, heroImage, RATIOS } from './plan'
import { FORMATS, loadSettings, saveSettings, throttleParams, throttleProfile, type Settings } from './settings'
import { createStaticLoader, type StaticFormat } from './staticLoader'

/** One entry of /api/images: `computeMetadata` plus the path. */
interface SourceImage {
  src: string
  file: string
  width: number
  height: number
  thumbhash: string
  color: string
}

// Written by scripts/build-static.ts in the static build.
const IMAGE_LIST = STATIC ? `${BASE}api/images.json` : '/api/images'
const GALLERY = STATIC ? GALLERY_SIZE.static : GALLERY_SIZE.live

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [run, setRun] = useState(0)
  const [images, setImages] = useState<SourceImage[]>([])

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

  const placeholderFor = (image: SourceImage) =>
    settings.placeholder === 'thumbhash'
      ? `thumbhash:${image.thumbhash}`
      : settings.placeholder === 'color'
        ? image.color
        : 'none'
  const source = (image: SourceImage) => ({
    src: image.src,
    srcWidth: image.width,
    srcHeight: image.height,
    placeholder: placeholderFor(image),
  })
  // loading="native" needs URLs in the HTML, so images without `width` need
  // `sizes` there. In lazy mode, `sizes` would turn measuring off.
  const nativeSizes = (sizes: string) => (settings.loading === 'native' ? { sizes } : {})
  const pick = (i: number) => images[i % images.length]!
  const hero = heroImage(images)
  // A measured fill ratio can't be pre-rendered, so the static build fixes it.
  const fillRatio = (ratio: number) => (STATIC ? { aspectRatio: ratio } : {})

  return (
    <LazyEaseProvider
      loader={loader}
      loading={settings.loading}
      rootMargin={`${settings.rootMargin}px`}
      dwellTime={settings.dwellTime}
      fadeDuration={settings.fadeDuration}
    >
      <header className="topbar">
        <div className="brand">
          <strong>lazy-ease</strong>
          <span>images at the size they are rendered at, behind an inline placeholder</span>
        </div>
        <Controls settings={settings} onChange={changeSettings} onReload={reload} />
      </header>
      {STATIC && (
        <p className="static-banner">
          Static demo: pre-rendered variants via a custom loader. Run <code>pnpm dev</code> for the live server.
        </p>
      )}

      {images.length === 0 || !hero ? (
        <p className="empty">
          {STATIC ? 'Loading the image list …' : 'Loading the image list … is the demo server running on port 3001?'}
        </p>
      ) : (
        <div key={demoKey}>
          <section className="hero">
            <DemoImage
              {...source(hero)}
              alt="Hero"
              fill
              aspectRatio={HERO_RATIO}
              {...nativeSizes('100vw')}
              frame={{ aspectRatio: '21 / 9' }}
              label="hero · fill · 21:9"
            />
          </section>

          <main>

            <section>
              <h2>Fixed size</h2>
              <p>
                <code>width</code> and <code>height</code>
              </p>
              <div className="row">
                {FIXED_SIZES.map((size, i) => (
                  <DemoImage key={i} {...source(pick(i + 2))} alt="" {...size} label={`${size.width}×${size.height}`} />
                ))}
              </div>
            </section>

            <section>
              <h2>Aspect ratio</h2>
              <p>
                <code>aspectRatio</code>, width from the grid cell
              </p>
              <div className="grid">
                {RATIOS.map(([label, ratio], i) => (
                  <DemoImage
                    key={label}
                    {...source(pick(i))}
                    alt=""
                    aspectRatio={ratio}
                    {...nativeSizes('(min-width: 900px) 20vw, 50vw')}
                    label={label}
                  />
                ))}
              </div>
            </section>

            <section>
              <h2>Fill</h2>
              <p>
                {STATIC ? (
                  <>
                    <code>fill</code> with a fixed <code>aspectRatio</code>
                  </>
                ) : (
                  <>
                    <code>fill</code>, crop follows the box ratio
                  </>
                )}
              </p>
              <div className="row fill-row">
                <DemoImage
                  {...source(pick(FILL.banner.image))}
                  alt=""
                  fill
                  {...fillRatio(FILL.banner.aspectRatio)}
                  frame={{ height: 260 }}
                  {...nativeSizes('(min-width: 900px) 60vw, 100vw')}
                  label="banner"
                />
                <DemoImage
                  {...source(pick(FILL.frame.image))}
                  alt=""
                  fill
                  {...fillRatio(FILL.frame.aspectRatio)}
                  frame={{ width: 220, height: 320 }}
                  {...nativeSizes('220px')}
                  label="220×320 frame"
                />
              </div>
            </section>

            <section>
              <h2>External image</h2>
              <p>Original JPEG, not resized or throttled</p>
              <div className="row">
                <DemoImage
                  src={new URL(`${BASE}external/${pick(EXTERNAL_IMAGE).file}`, location.href).href}
                  alt=""
                  width={400}
                  height={Math.round((400 * pick(EXTERNAL_IMAGE).height) / pick(EXTERNAL_IMAGE).width)}
                  placeholder={placeholderFor(pick(EXTERNAL_IMAGE))}
                  label="external · 400px"
                />
              </div>
            </section>

            <section>
              <h2>Scroll gallery</h2>
              <div className="gallery">
                {Array.from({ length: GALLERY }, (_, i) => {
                  const [label, ratio] = galleryRatio(i, images.length)
                  return (
                    <DemoImage
                      key={i}
                      {...source(pick(i))}
                      alt=""
                      aspectRatio={ratio}
                      {...nativeSizes('(min-width: 1000px) 33vw, (min-width: 680px) 50vw, 100vw')}
                      label={`#${i + 1} · ${label}`}
                    />
                  )
                })}
              </div>
            </section>
          </main>
        </div>
      )}
    </LazyEaseProvider>
  )
}
