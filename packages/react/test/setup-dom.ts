import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'
import { resetWarnings } from '../src/dev.js'
import { resetFormatDetection } from '../src/format.js'
import { installDom, resetDom } from './dom.js'

beforeEach(() => {
  resetDom()
  installDom()
  resetFormatDetection()
  resetWarnings()
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
