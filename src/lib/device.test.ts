import { describe, expect, it } from 'vitest'
import {
  heavyWorkerCount,
  MAX_WORKERS_HIGH_MEMORY,
  pixelBudgetFor,
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

  it('tiers iPhone workers conservatively by reported cores', () => {
    expect(
      resolveWorkerCount({ userAgent: IPHONE_UA, hardwareConcurrency: 6 }),
    ).toBe(3)
    expect(
      resolveWorkerCount({ userAgent: IPHONE_UA, hardwareConcurrency: 4 }),
    ).toBe(2)
    expect(
      resolveWorkerCount({ userAgent: IPHONE_UA, hardwareConcurrency: 2 }),
    ).toBe(1)
    // Old WebKit without the API stays at the safe floor.
    expect(resolveWorkerCount({ userAgent: IPHONE_UA })).toBe(1)
  })

  it('uses the desktop tier for 7+ core iPads and the phone tier below', () => {
    expect(
      resolveWorkerCount({ userAgent: IPAD_UA, hardwareConcurrency: 8 }),
    ).toBe(7)
    expect(
      resolveWorkerCount({ userAgent: IPAD_UA, hardwareConcurrency: 7 }),
    ).toBe(6)
    expect(
      resolveWorkerCount({ userAgent: IPAD_UA, hardwareConcurrency: 6 }),
    ).toBe(3)
    expect(
      resolveWorkerCount({ userAgent: IPAD_UA, hardwareConcurrency: 4 }),
    ).toBe(2)
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

  it('uses the standard budget for high-memory Android', () => {
    expect(
      resolveWorkerCount({
        userAgent: ANDROID_UA,
        deviceMemory: 8,
        hardwareConcurrency: 8,
      }),
    ).toBe(7)
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
    expect(heavyWorkerCount(3)).toBe(2)
    expect(heavyWorkerCount(1)).toBe(1)
  })
})

describe('pixelBudgetFor', () => {
  it('scales with the device archive budget', () => {
    expect(
      pixelBudgetFor({ workerCount: 8, maxZipBytes: 2 * 1024 * 1024 * 1024 }),
    ).toBe(67_108_864)
    expect(
      pixelBudgetFor({ workerCount: 4, maxZipBytes: 1024 * 1024 * 1024 }),
    ).toBe(33_554_432)
  })

  it('floors constrained devices at 16 MP', () => {
    expect(
      pixelBudgetFor({ workerCount: 1, maxZipBytes: 384 * 1024 * 1024 }),
    ).toBe(16_000_000)
  })
})

describe('profileFromSignals', () => {
  it('gives iPhone the phone worker budget and 512 MiB zip cap', () => {
    const profile = profileFromSignals({
      userAgent: IPHONE_UA,
      hardwareConcurrency: 8,
    })
    expect(profile.workerCount).toBe(3)
    expect(profile.maxZipBytes).toBe(512 * 1024 * 1024)
  })

  it('gives iPad the tablet worker tier and 1 GiB zip budget', () => {
    const profile = profileFromSignals({
      userAgent: IPAD_UA,
      hardwareConcurrency: 8,
    })
    expect(profile.workerCount).toBe(7)
    expect(profile.maxZipBytes).toBe(1024 * 1024 * 1024)
  })

  it('gives low-memory Android a single worker and 384 MiB zip cap', () => {
    const profile = profileFromSignals({
      userAgent: ANDROID_UA,
      deviceMemory: 4,
      hardwareConcurrency: 8,
    })
    expect(profile.workerCount).toBe(1)
    expect(profile.maxZipBytes).toBe(384 * 1024 * 1024)
  })

  it('gives high-memory desktop the standard budget', () => {
    const profile = profileFromSignals({
      deviceMemory: 8,
      hardwareConcurrency: 8,
    })
    expect(profile.workerCount).toBe(7)
    expect(profile.maxZipBytes).toBe(2 * 1024 * 1024 * 1024)
  })

  it('gives low-memory desktop a reduced budget', () => {
    const profile = profileFromSignals({
      deviceMemory: 4,
      hardwareConcurrency: 8,
    })
    expect(profile.workerCount).toBe(6)
    expect(profile.maxZipBytes).toBe(1024 * 1024 * 1024)
  })

  it('applies the override while preserving platform limits', () => {
    const profile = profileFromSignals({ userAgent: IPHONE_UA }, 99)
    expect(profile.workerCount).toBe(MAX_WORKERS_HIGH_MEMORY)
  })
})
