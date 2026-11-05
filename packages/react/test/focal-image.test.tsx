import { render } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { rgbaToThumbHash, thumbHashToApproximateAspectRatio } from 'thumbhash'
import { describe, expect, it, vi } from 'vitest'
import { LazyEaseProvider } from '../src/context.js'
import { coverPosition, cropWindow, focusInWindow } from '../src/focal.js'
import { Image, type ImageProps } from '../src/Image.js'
import { advance, intersect, setRect } from './dom.js'

const html = (props: Partial<ImageProps>) => renderToString(<Image src="/a.jpg" alt="" {...props} />)
const img = (markup: string) => markup.match(/<img[^>]*>/)![0]
const attr = (tag: string, name: string) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1]
const unescape = (value: string) => value.replace(/&amp;/g, '&')

function solidThumbHash(): string {
  const rgba = new Uint8Array(16 * 8 * 4)
  for (let i = 0; i < rgba.length; i += 4) rgba.set([255, 0, 0, 255], i)
  return btoa(String.fromCharCode(...rgbaToThumbHash(16, 8, rgba)))
}

const FOCUS = { x: 30, y: 70 }

describe('focal point in URLs', () => {
  it('goes into every classic URL of a cropped image', () => {
    const srcset = unescape(attr(img(html({ aspectRatio: 1.5, sizes: '50vw', focalPoint: FOCUS })), 'srcSet')!)
    for (const candidate of srcset.split(', ')) expect(candidate).toContain('ar=1.5&fmt=webp&fx=30&fy=70&q=75&w=')
  })

  it('is rounded and left out at the center', () => {
    expect(html({ aspectRatio: 1.5, sizes: '50vw', focalPoint: { x: 29.6, y: 70.4 } })).toContain('fx=30&amp;fy=70')
    expect(html({ aspectRatio: 1.5, sizes: '50vw', focalPoint: { x: 50, y: 50 } })).not.toContain('fx=')
  })

  it('is not sent without a crop', () => {
    expect(html({ fill: true, sizes: '100vw', focalPoint: FOCUS, srcWidth: 1600, srcHeight: 500 })).not.toContain('fx=')
  })

  it('goes into the no-JS fallback', () => {
    const noscript = html({ width: 320, height: 240, focalPoint: FOCUS }).match(/<noscript>.*<\/noscript>/)![0]
    expect(noscript).toContain('fx=30&amp;fy=70')
  })

  it('loads a new variant in measured mode when it changes', async () => {
    const element = (focalPoint: ImageProps['focalPoint']) => (
      <LazyEaseProvider>
        <Image src="/photos/lake.jpg" alt="" width={320} height={240} focalPoint={focalPoint} />
      </LazyEaseProvider>
    )
    const result = render(element(FOCUS))
    const box = result.container.querySelector<HTMLElement>('[data-state]')!
    setRect(box, { width: 320, height: 240 })
    intersect(box)
    await advance()
    const image = box.querySelector('img')!
    expect(image.getAttribute('srcset')).toContain('ar=1.333&fmt=avif&fx=30&fy=70&q=75&w=640 640w')
    result.rerender(element({ x: 10, y: 20 }))
    expect(image.getAttribute('srcset')).toContain('fx=10&fy=20')
  })
})

describe('focal point in the browser', () => {
  it('centers the point on an uncropped image from the source ratio, in the server HTML', () => {
    const markup = html({ fill: true, sizes: '100vw', priority: true, focalPoint: FOCUS, srcWidth: 1600, srcHeight: 500 })
    expect(markup).toContain('container-type:size')
    const style = attr(img(markup), 'style')!
    expect(style).toContain('position:relative')
    expect(style).toContain(`object-position:${coverPosition(3.2, FOCUS)}`)
  })

  it('places the rest of a server crop from where the point lands in the window', () => {
    const style = attr(img(html({ aspectRatio: 1.5, sizes: '50vw', focalPoint: FOCUS, srcWidth: 2000, srcHeight: 1000 })), 'style')!
    const focus = focusInWindow(2000, 1000, cropWindow(2000, 1000, 1.5, FOCUS), FOCUS)
    expect(style).toContain(`object-position:${coverPosition(1.5, focus)}`)
  })

  it('leaves a server crop centered without the source size', () => {
    const style = attr(img(html({ aspectRatio: 1.5, sizes: '50vw', focalPoint: FOCUS })), 'style')!
    expect(style).not.toContain('object-position')
  })

  it('falls back to a percentage and warns when the ratio is unknown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const markup = html({ fill: true, sizes: '100vw', focalPoint: FOCUS })
    expect(attr(img(markup), 'style')).toContain('object-position:30% 70%')
    render(<Image src="/warn.jpg" alt="" fill sizes="100vw" focalPoint={FOCUS} />)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`srcWidth` and `srcHeight`'))
    warn.mockRestore()
  })

  it('changes nothing without a focal point', () => {
    const markup = html({ fill: true, sizes: '100vw', srcWidth: 1600, srcHeight: 500 })
    expect(markup).not.toContain('container-type')
    expect(markup).not.toContain('object-position')
  })

  it('ignores it in intrinsic mode, which never crops', () => {
    const markup = html({ width: 300, focalPoint: FOCUS })
    expect(markup).not.toContain('container-type')
    expect(markup).not.toContain('fx=')
  })
})

describe('focal point on the placeholder', () => {
  it('moves an image placeholder to a layer placed like the image', () => {
    const hash = solidThumbHash()
    const markup = html({ width: 320, height: 240, priority: true, placeholder: `thumbhash:${hash}`, focalPoint: FOCUS })
    const layer = markup.match(/<span aria-hidden="true" style="([^"]*)"/)![1]!
    expect(layer).toContain('background-image:url(')
    expect(layer).toContain('background-size:cover')
    // The ThumbHash stores the source's approximate ratio.
    const ratio = thumbHashToApproximateAspectRatio(Uint8Array.from(atob(hash), (c) => c.charCodeAt(0)))
    expect(layer).toContain(`background-position:${coverPosition(ratio, FOCUS)}`)
    const box = markup.match(/<span data-state="[^"]*" style="([^"]*)"/)![1]!
    expect(box).not.toContain('background-image')
    expect(box).toContain('background-color')
  })

  it('keeps a color placeholder on the box', () => {
    const markup = html({ width: 320, height: 240, placeholder: '#123456', focalPoint: FOCUS })
    expect(markup).not.toContain('aria-hidden')
    expect(markup).toContain('background-color:#123456')
  })
})
