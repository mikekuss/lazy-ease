import * as core from '@lazy-ease/core'
import { describe, expect, it } from 'vitest'
import { cropWindow, DEFAULT_RATIOS, DEFAULT_WIDTHS, formatNumber } from '../src/contract.js'

// Client and server must agree on the contract (spec 3). Both take it from
// @lazy-ease/core, so the server must not carry a copy of its own.
describe('client and server contract', () => {
  it('uses the core ladders, number spelling and crop window', () => {
    expect(DEFAULT_WIDTHS).toBe(core.DEFAULT_WIDTHS)
    expect(DEFAULT_RATIOS).toBe(core.DEFAULT_RATIOS)
    expect(formatNumber).toBe(core.formatNumber)
    expect(cropWindow).toBe(core.cropWindow)
  })
})
