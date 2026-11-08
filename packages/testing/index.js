// Plain ESM without a build step, so the published files are the fixtures
// themselves. Import attributes need Node 20.10+, a current browser or a
// bundler that understands JSON modules. Readers in other languages use the
// JSON files directly; see README.md.

import backend from './fixtures/backend.json' with { type: 'json' }
import candidates from './fixtures/candidates.json' with { type: 'json' }
import crops from './fixtures/crops.json' with { type: 'json' }
import focal from './fixtures/focal.json' with { type: 'json' }
import ladders from './fixtures/ladders.json' with { type: 'json' }
import manifest from './fixtures/manifest.json' with { type: 'json' }
import numbers from './fixtures/numbers.json' with { type: 'json' }
import outputs from './fixtures/outputs.json' with { type: 'json' }
import tokens from './fixtures/tokens.json' with { type: 'json' }
import urls from './fixtures/urls.json' with { type: 'json' }

export const FIXTURE_FORMAT = 'lazy-ease-fixtures'
export const FIXTURE_VERSION = 1

export { manifest }

export const fixtures = { ladders, numbers, focal, crops, outputs, candidates, urls, backend, tokens }

/**
 * The cases of `file` with operation `op` (every case when `op` is omitted).
 * Cases tagged with one of `skipTopics` are left out; list them with
 * `skippedCases` so a skip stays visible in the test output.
 */
export function casesOf(file, op, { skipTopics = [] } = {}) {
  return fixtures[file].cases.filter(
    (c) => (op === undefined || c.op === op) && !(c.topics ?? []).some((t) => skipTopics.includes(t)),
  )
}

/** The cases of `file` (with operation `op`) that `casesOf` leaves out for `skipTopics`. */
export function skippedCases(file, op, { skipTopics = [] } = {}) {
  return fixtures[file].cases.filter(
    (c) => (op === undefined || c.op === op) && (c.topics ?? []).some((t) => skipTopics.includes(t)),
  )
}
