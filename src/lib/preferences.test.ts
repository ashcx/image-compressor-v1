import { describe, expect, it } from 'vitest'
import { parseStoredPreferences } from './preferences'

const DEFAULTS = { theme: 'auto', maxWorkers: null, compatibilityMode: false }

describe('parseStoredPreferences', () => {
  it('falls back to defaults for malformed payloads', () => {
    expect(parseStoredPreferences(null)).toEqual(DEFAULTS)
    expect(parseStoredPreferences('nope')).toEqual(DEFAULTS)
    expect(parseStoredPreferences(42)).toEqual(DEFAULTS)
  })

  it('keeps valid stored values', () => {
    expect(
      parseStoredPreferences({
        theme: 'dark',
        maxWorkers: 4,
        compatibilityMode: true,
      }),
    ).toEqual({ theme: 'dark', maxWorkers: 4, compatibilityMode: true })
  })

  it('rejects invalid fields individually', () => {
    expect(
      parseStoredPreferences({
        theme: 'blue',
        maxWorkers: -2,
        compatibilityMode: 'yes',
      }),
    ).toEqual(DEFAULTS)
  })

  it('rounds fractional worker counts and accepts auto', () => {
    expect(parseStoredPreferences({ maxWorkers: 3.7 }).maxWorkers).toBe(4)
    expect(parseStoredPreferences({ theme: 'light' })).toMatchObject({
      theme: 'light',
      maxWorkers: null,
    })
  })
})
