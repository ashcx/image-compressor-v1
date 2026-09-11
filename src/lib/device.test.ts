import { describe, expect, it } from 'vitest'
import {
  heavyWorkerCount,
  MAX_WORKERS_HIGH_MEMORY,
  profileFromSignals,
  resolveWorkerCount,
} from './device'

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const IPAD_UA =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36'

describe('resolveWorkerCount', () => {
  it('uses the override regardless of platform', () => {
    expect(resolveWorkerCount({ userAgent: IPHONE_UA }, 2)).toBe(2)
    expect(resolveWorkerCount({ userAgent: ANDROID_UA }, 3)).toBe(3)
  })

  it('caps the override at the high-memory maximum', () => {
    expect(resolveWorkerCount({}, 99)).toBe(MAX_WORKERS_HIGH_MEMORY)
  })

  it('returns 1 for iPhone', () => {
    expect(
      resolveWorkerCount({ userAgent: IPHONE_UA, hardwareConcurrency: 8 }),
    ).toBe(1)
  })

  it('tiers iPad workers by core count, reserving a core', () => {
    expect(
      resolveWorkerCount({ userAgent: IPAD_UA, hardwareConcurrency: 8 }),
    ).toBe(7)
    expect(
      resolveWorkerCount({ userAgent: IPAD_UA, hardwareConcurrency: 6 }),
    ).toBe(4)
    expect(
      resolveWorkerCount({ userAgent: IPAD_UA, hardwareConcurrency: 2 }),
    ).toBe(1)
  })

  it('treats a touch-enabled Macintosh as an iPad', () => {
    expect(
      resolveWorkerCount({
        userAgent: MAC_UA,
        maxTouchPoints: 5,
        hardwareConcurrency: 8,
      }),
    ).toBe(7)
  })

  it('returns 1 for low-memory Android', () => {
    expect(
      resolveWorkerCount({
        userAgent: ANDROID_UA,
        deviceMemory: 4,
        hardwareConcurrency: 8,
      }),
    ).toBe(1)
  })

  it('returns min(cores - 1, 4) for high-memory Android', () => {
    expect(
      resolveWorkerCount({
        userAgent: ANDROID_UA,
        deviceMemory: 8,
        hardwareConcurrency: 8,
      }),
    ).toBe(4)
  })

  it('uses the desktop worker budget, reserving a core', () => {
    expect(
      resolveWorkerCount({ deviceMemory: 16, hardwareConcurrency: 24 }),
    ).toBe(MAX_WORKERS_HIGH_MEMORY)
    expect(
      resolveWorkerCount({ deviceMemory: 8, hardwareConcurrency: 8 }),
    ).toBe(7)
    expect(
      resolveWorkerCount({ deviceMemory: 4, hardwareConcurrency: 8 }),
    ).toBe(6)
    expect(resolveWorkerCount({ hardwareConcurrency: 4 })).toBe(3)
  })

  it('halves workers for heavy codecs but never to zero', () => {
    expect(heavyWorkerCount(8)).toBe(4)
    expect(heavyWorkerCount(3)).toBe(1)
    expect(heavyWorkerCount(1)).toBe(1)
  })
})

describe('profileFromSignals', () => {
  it('marks iPhone as constrained', () => {
    const profile = profileFromSignals({
      userAgent: IPHONE_UA,
      hardwareConcurrency: 8,
    })
    expect(profile.workerCount).toBe(1)
    expect(profile.constrained).toBe(true)
    expect(profile.maxZipBytes).toBe(512 * 1024 * 1024)
  })

  it('marks iPad as constrained with a 1 GiB zip budget', () => {
    const profile = profileFromSignals({
      userAgent: IPAD_UA,
      hardwareConcurrency: 8,
    })
    expect(profile.workerCount).toBe(7)
    expect(profile.constrained).toBe(true)
    expect(profile.maxZipBytes).toBe(1024 * 1024 * 1024)
  })

  it('marks low-memory Android as constrained', () => {
    const profile = profileFromSignals({
      userAgent: ANDROID_UA,
      deviceMemory: 4,
      hardwareConcurrency: 8,
    })
    expect(profile.workerCount).toBe(1)
    expect(profile.constrained).toBe(true)
    expect(profile.maxZipBytes).toBe(384 * 1024 * 1024)
  })

  it('treats high-memory desktop as unconstrained', () => {
    const profile = profileFromSignals({
      deviceMemory: 8,
      hardwareConcurrency: 8,
    })
    expect(profile.workerCount).toBe(7)
    expect(profile.constrained).toBe(false)
    expect(profile.maxZipBytes).toBe(2 * 1024 * 1024 * 1024)
  })

  it('treats low-memory desktop as constrained', () => {
    const profile = profileFromSignals({
      deviceMemory: 4,
      hardwareConcurrency: 8,
    })
    expect(profile.workerCount).toBe(6)
    expect(profile.constrained).toBe(true)
    expect(profile.maxZipBytes).toBe(1024 * 1024 * 1024)
  })

  it('applies the override while preserving platform limits', () => {
    const profile = profileFromSignals({ userAgent: IPHONE_UA }, 99)
    expect(profile.workerCount).toBe(MAX_WORKERS_HIGH_MEMORY)
    expect(profile.constrained).toBe(true)
  })
})
