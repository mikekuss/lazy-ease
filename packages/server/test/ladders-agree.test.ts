import { describe, expect, it } from 'vitest'
import { cropWindow as clientCropWindow } from '../../react/src/focal.js'
import { formatNumber as clientFormat } from '../../react/src/numbers.js'
import { DEFAULT_RATIOS as CLIENT_RATIOS } from '../../react/src/ratios.js'
import { DEFAULT_WIDTHS as CLIENT_WIDTHS } from '../../react/src/widths.js'
import { cropWindow, DEFAULT_RATIOS, DEFAULT_WIDTHS, formatNumber } from '../src/contract.js'

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

  it('computes the same focal crop window', () => {
    for (const [width, height] of [[2000, 1000], [1000, 2000], [801, 599], [1600, 500], [300, 200]] as const) {
      for (const ratio of DEFAULT_RATIOS) {
        for (const x of [0, 13, 50, 87, 100]) {
          const focus = { x, y: 100 - x }
          expect(cropWindow(width, height, ratio, focus)).toEqual(clientCropWindow(width, height, ratio, focus))
        }
      }
    }
  })
})
