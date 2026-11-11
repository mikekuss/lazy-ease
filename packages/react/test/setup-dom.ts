import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { resetFormatDetection } from '../../core/src/dom/format.js'
import { resetObservers } from '../../core/src/dom/observe.js'
import { resetWarnings } from '../src/dev.js'
import { installDom, resetDom } from './dom.js'

beforeEach(() => {
  resetDom()
  installDom()
  resetFormatDetection()
  resetObservers()
  resetWarnings()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
