import { createLoader, LazyEaseProvider } from 'lazy-ease'
import { useEffect, useMemo, useState } from 'react'
import { Controls } from './Controls'
import { DemoImage } from './DemoImage'
import { FORMATS, loadSettings, saveSettings, throttleParams, type Settings } from './settings'
import { resetStats } from './stats'

interface SourceImage {
  src: string
  width: number
  height: number
  placeholders: { blur: string; color: string }
}

const RATIOS: [string, number][] = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['2:3', 2 / 3],
]

export function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings)
  const [run, setRun] = useState(0)
  const [images, setImages] = useState<SourceImage[]>([])

  useEffect(() => {
    fetch('/api/images')
      .then((response) => response.json())
      .then(setImages)
      .catch((error) => console.error('Could not load the image list', error))
  }, [])

  useEffect(() => saveSettings(settings), [settings])

  // `run` makes every URL new, so "Reload images" bypasses the browser cache.
  const loader = useMemo(
    () => createLoader({ params: { ...throttleParams(settings), run } }),
    [settings, run],
  )
  // Any change restarts the demo so you can watch it from a clean state.
  const demoKey = `${run}-${JSON.stringify(settings)}`
  // Reset in the handlers, not in an effect: child effects run before the
  // parent's and would be counted before the reset.
  const restart = () => {
    resetStats()
    performance.clearResourceTimings()
  }
  const changeSettings = (next: Settings) => {
    restart()
    setSettings(next)
  }
  const reload = () => {
    restart()
    window.scrollTo({ top: 0 })
    setRun((value) => value + 1)
  }

  const placeholderFor = (image: SourceImage) =>
    settings.placeholder === 'none' ? undefined : image.placeholders[settings.placeholder]
  const hero = images.find((image) => image.width / image.height > 2) ?? images[0]

  return (
    <LazyEaseProvider
      loader={loader}
      formats={FORMATS[settings.formats]}
      loading={settings.loading}
      rootMargin={`${settings.rootMargin}px`}
      fadeDuration={settings.fadeDuration}
    >
      <header className="topbar">
        <div className="brand">
          <strong>lazy-ease</strong>
          <span>lazy-loaded, optimized images with a placeholder crossfade</span>
        </div>
        <Controls settings={settings} onChange={changeSettings} onReload={reload} />
      </header>

      {images.length === 0 ? (
        <p className="empty">Loading the image list … is the demo server running on port 3001?</p>
      ) : (
        <main key={demoKey}>
          <p className="intro">
            Every placeholder is an inline data URI that ships with the image list, so it is the CSS background
            on the very first render, without a request. Each image loads through a <code>&lt;picture&gt;</code>{' '}
            with one <code>&lt;source&gt;</code> per format and only fades in once it is fully loaded and decoded.
          </p>

          {hero && (
            <section>
              <h2>Hero with priority</h2>
              <p>
                Loads eagerly with <code>fetchpriority="high"</code>, and still fades in as a whole instead of
                painting from top to bottom.
              </p>
              <DemoImage
                src={hero.src}
                alt=""
                aspectRatio={21 / 9}
                priority
                placeholder={placeholderFor(hero)}
                label="21:9 priority"
              />
            </section>
          )}

          <section>
            <h2>Aspect ratios</h2>
            <p>Same component, different <code>aspectRatio</code>. The server crops to each ratio.</p>
            <div className="grid">
              {RATIOS.map(([label, ratio], i) => {
                const image = images[i % images.length]!
                return (
                  <DemoImage
                    key={label}
                    src={image.src}
                    alt=""
                    aspectRatio={ratio}
                    sizes="(min-width: 900px) 20vw, 50vw"
                    placeholder={placeholderFor(image)}
                    label={label}
                  />
                )
              })}
            </div>
          </section>

          <section>
            <h2>Fixed size</h2>
            <p>
              With <code>width</code> the srcset only holds the 1x and 2x variants.
            </p>
            <div className="row">
              {[
                { image: images[2 % images.length]!, width: 320, height: 240, label: '320×240' },
                { image: images[3 % images.length]!, width: 200, height: 200, label: '200×200' },
              ].map(({ image, label, ...size }) => (
                <DemoImage key={label} src={image.src} alt="" {...size} placeholder={placeholderFor(image)} label={label} />
              ))}
            </div>
          </section>

          <section>
            <h2>Scroll gallery</h2>
            <p>
              {settings.loading === 'lazy'
                ? `Images start loading ${settings.rootMargin}px before they scroll into view.`
                : settings.loading === 'native'
                  ? 'The browser decides when to load (loading="lazy").'
                  : 'Everything loads right away.'}
            </p>
            <div className="gallery">
              {Array.from({ length: 30 }, (_, i) => {
                const image = images[i % images.length]!
                const [label, ratio] = RATIOS[(i * 2 + Math.floor(i / images.length)) % RATIOS.length]!
                return (
                  <DemoImage
                    key={i}
                    src={image.src}
                    alt=""
                    aspectRatio={ratio}
                    sizes="(min-width: 900px) 33vw, 100vw"
                    placeholder={placeholderFor(image)}
                    label={`#${i + 1} · ${label}`}
                  />
                )
              })}
            </div>
          </section>
        </main>
      )}
    </LazyEaseProvider>
  )
}
