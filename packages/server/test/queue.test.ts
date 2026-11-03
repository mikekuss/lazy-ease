import { describe, expect, it } from 'vitest'
import { createRenderQueue, mapSharpError, withTimeout } from '../src/render.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createRenderQueue', () => {
  it('runs one task per key and shares its result', async () => {
    const queue = createRenderQueue(4)
    const gate = deferred<string>()
    let calls = 0
    const task = () => {
      calls++
      return gate.promise
    }
    const results = Promise.all([queue.run('a', task), queue.run('a', task), queue.run('a', task)])
    gate.resolve('done')
    expect(await results).toEqual(['done', 'done', 'done'])
    expect(calls).toBe(1)
  })

  it('shares a rejection and runs again after it settled', async () => {
    const queue = createRenderQueue(1)
    const failing = Promise.all([
      queue.run('a', () => Promise.reject(new Error('boom'))),
      queue.run('a', () => Promise.resolve('unused')),
    ])
    await expect(failing).rejects.toThrow('boom')
    expect(await queue.run('a', () => Promise.resolve('second'))).toBe('second')
  })

  it('keeps distinct keys apart', async () => {
    const queue = createRenderQueue(4)
    expect(await Promise.all([queue.run('a', async () => 1), queue.run('b', async () => 2)])).toEqual([1, 2])
  })

  it('caps the number of running tasks', async () => {
    const queue = createRenderQueue(2)
    const gates = [0, 1, 2, 3, 4].map(() => deferred<number>())
    let running = 0
    let peak = 0
    const runs = gates.map((gate, i) =>
      queue.run(String(i), async () => {
        running++
        peak = Math.max(peak, running)
        try {
          return await gate.promise
        } finally {
          running--
        }
      }),
    )
    await tick()
    expect(running).toBe(2)
    expect(queue.active).toBe(2)
    gates.forEach((gate, i) => gate.resolve(i))
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4])
    expect(peak).toBe(2)
    expect(queue.active).toBe(0)
  })

  it('frees the slot when a task fails', async () => {
    const queue = createRenderQueue(1)
    await expect(queue.run('a', () => Promise.reject(new Error('x')))).rejects.toThrow()
    expect(await queue.run('b', async () => 'ok')).toBe('ok')
  })

  it('rejects a concurrency below 1', () => {
    expect(() => createRenderQueue(0)).toThrow(RangeError)
  })
})

describe('withTimeout', () => {
  it('passes a fast result through', async () => {
    expect(await withTimeout(Promise.resolve(1), 100)).toBe(1)
  })

  it('rejects with a 504 when too slow', async () => {
    await expect(withTimeout(new Promise(() => {}), 5)).rejects.toMatchObject({ status: 504 })
  })
})

describe('mapSharpError', () => {
  it('maps sharp timeouts to 504 and pixel limits to 413', () => {
    expect(mapSharpError(new Error('timeout: 42% complete'))).toMatchObject({ status: 504 })
    expect(mapSharpError(new Error('Input image exceeds pixel limit'))).toMatchObject({ status: 413 })
  })

  it('passes other errors through', () => {
    const error = new Error('VipsJpeg: Premature end of input file')
    expect(mapSharpError(error)).toBe(error)
  })
})
