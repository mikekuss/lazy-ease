import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import sharp, { type Sharp } from 'sharp'

export const solid = (width: number, height: number, background = '#33aa77') =>
  sharp({ create: { width, height, channels: 3, background } })

/** Left half red, right half blue, so orientation can be checked by pixel. */
export async function split(width: number, height: number): Promise<Sharp> {
  const half = await solid(width / 2, height, '#0000ff').png().toBuffer()
  return solid(width, height, '#ff0000').composite([{ input: half, left: width / 2, top: 0 }])
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A tiny PNG whose header claims `width × height`. Decoding it would fail, but the size check comes first. */
export function hugePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 0, 0, 0, 0], 8) // 8-bit grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(0))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export interface Fixtures {
  dir: string
  root: string
  cleanup(): Promise<void>
}

/** Writes the source images every server test uses into a fresh temp directory. */
export async function createFixtures(): Promise<Fixtures> {
  const dir = await mkdtemp(path.join(tmpdir(), 'lazy-ease-'))
  const root = path.join(dir, 'images')
  await mkdir(path.join(root, 'my photos'), { recursive: true })
  const write = (name: string, data: Buffer | string) => writeFile(path.join(root, name), data)

  await write('big.jpg', await solid(2000, 1000).jpeg().toBuffer())
  await write('small.jpg', await solid(300, 200).jpeg().toBuffer())
  await write('portrait.png', await solid(600, 1200).png().toBuffer())
  await write('photo.webp', await solid(800, 600).webp().toBuffer())
  await write('photo.avif', await solid(800, 600).avif().toBuffer())
  await write('UPPER.JPG', await solid(100, 100).jpeg().toBuffer())
  await write('my photos/café.jpg', await solid(1600, 1200).jpeg().toBuffer())
  await write('icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  await write('scan.tiff', await solid(100, 100).tiff().toBuffer())
  await write('scan.tif', await solid(100, 100).tiff().toBuffer())
  await write('notes.txt', 'hello')
  await write('broken.jpg', Buffer.from('not an image'))
  await write('huge.png', hugePng(10_000, 6_000))

  // Stored landscape with EXIF orientation 6 (rotate 90° clockwise to display),
  // plus EXIF, GPS, XMP and a Display P3 profile that must not reach the output.
  await write(
    'exif.jpg',
    await (await split(400, 200))
      .withExif({
        IFD0: { Copyright: 'secret copyright', Artist: 'secret artist' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '52/1 31/1 0/1' },
      })
      .withMetadata({ orientation: 6 })
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"><secret>xmp</secret></x:xmpmeta>')
      .withIccProfile('p3')
      .jpeg()
      .toBuffer(),
  )

  const frames = await Promise.all(['#ff0000', '#0000ff'].map((c) => solid(200, 100, c).png().toBuffer()))
  await write('animated.gif', await sharp(frames, { join: { animated: true } }).gif().toBuffer())

  await writeFile(path.join(dir, 'secret.jpg'), await solid(10, 10).jpeg().toBuffer())
  return { dir, root, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

export async function decode(response: Response) {
  const buffer = Buffer.from(await response.arrayBuffer())
  return { buffer, meta: await sharp(buffer).metadata() }
}
