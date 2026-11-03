import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { HTTPException } from 'hono/http-exception'

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.tif', '.tiff'])

/**
 * Maps a `src` query value to a file inside `root`. Rejects remote URLs,
 * unknown extensions and anything that resolves outside `root`.
 */
export async function resolveSource(root: string, src: string | undefined): Promise<string> {
  if (!src) throw new HTTPException(400, { message: 'Missing src' })
  if (src.includes('\0')) throw new HTTPException(400, { message: 'Invalid src' })
  if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith('//')) {
    throw new HTTPException(400, { message: 'Remote sources are not supported' })
  }
  if (!EXTENSIONS.has(path.extname(src).toLowerCase())) {
    throw new HTTPException(400, { message: 'Unsupported file type' })
  }

  const rootDir = await realpath(root)
  // Normalizing against "/" strips any ".." that would climb above the root.
  const candidate = path.join(rootDir, path.posix.normalize(`/${src}`))

  let file: string
  try {
    file = await realpath(candidate)
    if (!(await stat(file)).isFile()) throw new Error('Not a file')
  } catch {
    throw new HTTPException(404, { message: 'Image not found' })
  }
  // Symlinks could still point outside the root.
  if (!file.startsWith(rootDir + path.sep)) {
    throw new HTTPException(404, { message: 'Image not found' })
  }
  return file
}
