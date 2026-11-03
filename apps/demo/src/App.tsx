import { createLoader, LazyEaseProvider, type ImageLoader } from 'lazy-ease'
import { useEffect, useMemo, useState } from 'react'
import { Controls } from './Controls'
import { DemoImage } from './DemoImage'
import { FORMATS, loadSettings, saveSettings, throttleParams, type Settings } from './settings'

/** One entry of /api/images: `computeMetadata` plus the path. */
interface SourceImage {
  src: string
  file: string
  width: number
  height: number
  thumbhash: string
  color: string
}

const RATIOS: [string, number][] = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['2:3', 2 / 3],
]

const GALLERY_SIZE = 40

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [run, setRun] = useState(0)
  const [images, setImages] = useState<SourceImage[]>([])

  useEffect(() => {
    // On the first start the server is still generating the images, so retry.
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      fetch('/api/images')
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
  // cache. The demo server strips it and the throttle settings again.
  const loader = useMemo<ImageLoader>(
    () => ({
      ...createLoader({ params: { ...throttleParams(settings), ...(run > 0 ? { run } : {}) } }),
      formats: FORMATS[settings.formats],
    }),
    [settings, run],
  )
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
  const hero = images.find((image) => image.width / image.height > 2) ?? images[0]

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

      {images.length === 0 || !hero ? (
        <p className="empty">Loading the image list … is the demo server running on port 3001?</p>
      ) : (
        <div key={demoKey}>
          <section className="hero">
            <DemoImage
              {...source(hero)}
              alt="Hero"
              fill
              aspectRatio={21 / 9}
              sizes="100vw"
              priority
              frame={{ aspectRatio: '21 / 9' }}
              label="priority hero · fill · sizes=100vw"
            />
          </section>

          <main>
            <p className="intro">
              Each caption shows the box state, the measured box width, the delivered variant (width, format, bytes,
              load time) and what a plain <code>sizes="100vw"</code> srcset would have downloaded instead. The hero
              is classic mode: its URLs are in the HTML, it uses WebP and never fades. Everything else is measured
              on the client after it nears the viewport.
            </p>

            <section>
              <h2>Fixed size</h2>
              <p>
                <code>width</code> and <code>height</code>: the box reserves its space, the server crops to the ratio,
                and at most the 2× candidate is offered.
              </p>
              <div className="row">
                {[
                  { width: 320, height: 240 },
                  { width: 200, height: 200 },
                  { width: 480, height: 270 },
                ].map((size, i) => (
                  <DemoImage key={i} {...source(pick(i + 2))} alt="" {...size} label={`${size.width}×${size.height}`} />
                ))}
              </div>
            </section>

            <section>
              <h2>Aspect ratio</h2>
              <p>
                <code>aspectRatio</code> without a width: the box is as wide as its grid cell and the variant follows
                the measured width.
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
                <code>fill</code> covers a positioned parent. Without <code>aspectRatio</code> the crop follows the
                measured box ratio; resize the window to see it change.
              </p>
              <div className="row fill-row">
                <DemoImage
                  {...source(pick(5))}
                  alt=""
                  fill
                  frame={{ height: 260 }}
                  {...nativeSizes('(min-width: 900px) 60vw, 100vw')}
                  label="banner"
                />
                <DemoImage
                  {...source(pick(4))}
                  alt=""
                  fill
                  frame={{ width: 220, height: 320 }}
                  {...nativeSizes('220px')}
                  label="220×320 frame"
                />
              </div>
            </section>

            <section>
              <h2>External image</h2>
              <p>
                An absolute URL on a host outside <code>domains</code> loads as is: no srcset, no resizing, the
                original JPEG. Layout, placeholder and fade still apply. The throttle does not apply to it.
              </p>
              <div className="row">
                <DemoImage
                  src={new URL(`/external/${pick(0).file}`, location.href).href}
                  alt=""
                  width={400}
                  height={Math.round((400 * pick(0).height) / pick(0).width)}
                  placeholder={placeholderFor(pick(0))}
                  label="external · 400px"
                />
              </div>
            </section>

            <section>
              <h2>Scroll gallery</h2>
              <p>
                {settings.loading === 'lazy'
                  ? `Images start loading ${settings.rootMargin}px before they scroll into view` +
                    (settings.dwellTime > 0 ? ` and after ${settings.dwellTime} ms there.` : '.')
                  : settings.loading === 'native'
                    ? 'The browser decides when to load (loading="lazy").'
                    : 'Everything loads right away.'}
              </p>
              <div className="gallery">
                {Array.from({ length: GALLERY_SIZE }, (_, i) => {
                  const [label, ratio] = RATIOS[(i * 2 + Math.floor(i / images.length)) % RATIOS.length]!
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
