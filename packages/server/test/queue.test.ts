import { describe, expect, it } from 'vitest'
import { createRenderQueue, mapSharpError, withDeadline } from '../src/render.js'

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

const LATER = () => Date.now() + 60_000
const queueOf = (concurrency: number, maxPending = 100) => createRenderQueue({ concurrency, maxPending })

describe('createRenderQueue', () => {
  it('runs one task per key and shares its result', async () => {
    const queue = queueOf(4)
    const gate = deferred<string>()
    let calls = 0
    const task = () => {
      calls++
      return gate.promise
    }
    const results = Promise.all([queue.run('a', task, LATER()), queue.run('a', task, LATER()), queue.run('a', task, LATER())])
    gate.resolve('done')
    expect(await results).toEqual(['done', 'done', 'done'])
    expect(calls).toBe(1)
  })

  it('shares a rejection and runs again after it settled', async () => {
    const queue = queueOf(1)
    const failing = Promise.all([
      queue.run('a', () => Promise.reject(new Error('boom')), LATER()),
      queue.run('a', () => Promise.resolve('unused'), LATER()),
    ])
    await expect(failing).rejects.toThrow('boom')
    expect(await queue.run('a', () => Promise.resolve('second'), LATER())).toBe('second')
  })

  it('keeps distinct keys apart', async () => {
    const queue = queueOf(4)
    expect(await Promise.all([queue.run('a', async () => 1, LATER()), queue.run('b', async () => 2, LATER())])).toEqual([1, 2])
  })

  it('caps the number of running tasks', async () => {
    const queue = queueOf(2)
    const gates = [0, 1, 2, 3, 4].map(() => deferred<number>())
    let running = 0
    let peak = 0
    const runs = gates.map((gate, i) =>
      queue.run(
        String(i),
        async () => {
          running++
          peak = Math.max(peak, running)
          try {
            return await gate.promise
          } finally {
            running--
          }
        },
        LATER(),
      ),
    )
    await tick()
    expect(running).toBe(2)
    expect(queue.active).toBe(2)
    expect(queue.pending).toBe(3)
    gates.forEach((gate, i) => gate.resolve(i))
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4])
    expect(peak).toBe(2)
    expect(queue.active).toBe(0)
  })

  it('frees the slot when a task fails', async () => {
    const queue = queueOf(1)
    await expect(queue.run('a', () => Promise.reject(new Error('x')), LATER())).rejects.toThrow()
    expect(await queue.run('b', async () => 'ok', LATER())).toBe('ok')
  })

  it('rejects a concurrency below 1', () => {
    expect(() => queueOf(0)).toThrow(RangeError)
  })

  it('answers 503 with Retry-After when the pending list is full', async () => {
    const queue = createRenderQueue({ concurrency: 1, maxPending: 1, retryAfter: 2.5 })
    const gate = deferred<string>()
    const running = queue.run('a', () => gate.promise, LATER())
    const queued = queue.run('b', async () => 'b', LATER())
    const error = await queue.run('c', async () => 'c', LATER()).catch((e: unknown) => e)
    expect(error).toMatchObject({ status: 503 })
    const response = (error as { getResponse(): Response }).getResponse()
    expect(response.headers.get('retry-after')).toBe('3')
    // Joining a job that is already queued needs no new entry.
    const joined = queue.run('b', async () => 'unused', LATER())
    gate.resolve('a')
    expect(await Promise.all([running, queued, joined])).toEqual(['a', 'b', 'b'])
  })

  it('keeps the slot and the key until the work ends, after the response timed out', async () => {
    const queue = queueOf(1)
    const native = deferred<string>()
    let calls = 0
    const task = () => {
      calls++
      return native.promise
    }
    await expect(queue.run('a', task, Date.now() + 20)).rejects.toMatchObject({ status: 504 })
    // The native job still runs: its slot is taken, and the same key joins it.
    expect(queue.active).toBe(1)
    const joined = queue.run('a', task, LATER())
    const other = queue.run('b', async () => 'b', LATER())
    await tick()
    expect(queue.pending).toBe(1)
    expect(calls).toBe(1)
    native.resolve('a')
    expect(await Promise.all([joined, other])).toEqual(['a', 'b'])
    expect(queue.active).toBe(0)
  })

  it('counts the deadline from admission, waiting included, and drops an abandoned queued job', async () => {
    const queue = queueOf(1)
    const gate = deferred<string>()
    const running = queue.run('a', () => gate.promise, LATER())
    let started = false
    const queued = queue.run('b', async () => {
      started = true
      return 'b'
    }, Date.now() + 20)
    await expect(queued).rejects.toMatchObject({ status: 504 })
    expect(queue.pending).toBe(0)
    gate.resolve('a')
    await running
    await tick()
    expect(started).toBe(false)
  })

  it('rejects a deadline that has already passed', async () => {
    await expect(queueOf(1).run('a', async () => 1, Date.now() - 1)).rejects.toMatchObject({ status: 504 })
  })
})

describe('createRenderQueue deadlines', () => {
  it('never starts a queued job after its deadline, even before its timer runs', async () => {
    const queue = queueOf(1)
    const gate = deferred<string>()
    const running = queue.run('a', () => gate.promise, LATER())
    let started = false
    const deadline = Date.now() + 20
    const queued = queue.run('b', async () => ((started = true), 'b'), deadline)
    queued.catch(() => {})
    // Block the event loop past the deadline, so no timer has run when the slot frees.
    while (Date.now() < deadline + 2) {
      // busy wait
    }
    gate.resolve('a')
    await running
    await expect(queued).rejects.toMatchObject({ status: 504 })
    expect(started).toBe(false)
    expect(queue.pending).toBe(0)
  })
})

describe('withDeadline', () => {
  it('passes a fast result through', async () => {
    expect(await withDeadline(Promise.resolve(1), Date.now() + 100)).toBe(1)
  })

  it('rejects with a 504 when too slow, never before the deadline', async () => {
    const deadline = Date.now() + 5
    await expect(withDeadline(new Promise(() => {}), deadline)).rejects.toMatchObject({ status: 504 })
    expect(Date.now()).toBeGreaterThanOrEqual(deadline)
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
