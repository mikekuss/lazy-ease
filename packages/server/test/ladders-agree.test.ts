import { describe, expect, it } from 'vitest'
import { formatNumber as clientFormat } from '../../react/src/numbers.js'
import { DEFAULT_RATIOS as CLIENT_RATIOS } from '../../react/src/ratios.js'
import { DEFAULT_WIDTHS as CLIENT_WIDTHS } from '../../react/src/widths.js'
import { DEFAULT_RATIOS, DEFAULT_WIDTHS, formatNumber } from '../src/contract.js'

// The server does not import the client at runtime, so the two copies of the
// contract are compared here (spec 3: backend and loader must agree).
describe('client and server contract', () => {
  it('has the same width and ratio ladders', () => {
    expect(DEFAULT_WIDTHS).toEqual(CLIENT_WIDTHS)
    expect(DEFAULT_RATIOS).toEqual(CLIENT_RATIOS)
  })

  it('formats numbers the same way', () => {
    for (const value of [0.25, 1, 1.333, 1.5, 4, 64, 3840, 1e21]) {
      expect(formatNumber(value), String(value)).toBe(clientFormat(value))
    }
  })
})
