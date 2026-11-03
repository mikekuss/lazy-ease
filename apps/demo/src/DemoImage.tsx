import { Image, type ImageProps } from 'lazy-ease'
import { useRef, useState, type SyntheticEvent } from 'react'
import { recordLoad, recordStart } from './stats'

type Phase = 'idle' | 'loading' | 'loaded'

interface LoadInfo {
  width?: string
  format?: string
  bytes: number
  ms: number
}

interface DemoImageProps extends ImageProps {
  label?: string
}

/** `<Image>` with a caption that shows what was loaded and how long it took. */
export function DemoImage({ label, ...props }: DemoImageProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [info, setInfo] = useState<LoadInfo>()
  const startedAt = useRef<number>(undefined)
  const counted = useRef(false)

  const handleVisible = () => {
    if (startedAt.current !== undefined) return
    startedAt.current = performance.now()
    recordStart()
    setPhase('loading')
  }

  const handleLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    const entry = performance.getEntriesByName(img.currentSrc).at(-1) as
      | (PerformanceResourceTiming & { contentType?: string })
      | undefined
    const bytes = entry ? entry.transferSize || entry.encodedBodySize : 0
    const ms = entry ? entry.responseEnd - entry.startTime : performance.now() - (startedAt.current ?? 0)
    const url = new URL(img.currentSrc)
    setInfo({
      width: url.searchParams.get('w') ?? undefined,
      format: entry?.contentType?.replace('image/', ''),
      bytes,
      ms,
    })
    setPhase('loaded')
    if (!counted.current) {
      counted.current = true
      recordLoad(bytes)
    }
  }

  return (
    <figure className="demo-image">
      <Image {...props} onVisible={handleVisible} onLoad={handleLoad} />
      <figcaption>
        {label && <span className="label">{label}</span>}
        <span className={`phase phase-${phase}`}>{phase}</span>
        {info && (
          <span className="info">
            {[
              info.width && `${info.width}w`,
              info.format,
              info.bytes > 0 && `${(info.bytes / 1024).toFixed(0)} KB`,
              `${info.ms.toFixed(0)} ms`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </figcaption>
    </figure>
  )
}
