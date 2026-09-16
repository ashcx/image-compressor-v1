import { effect, signal } from '@preact/signals'
import { configureWorkerPreferences } from './device'

export type ThemePreference = 'auto' | 'light' | 'dark'

export interface StoredPreferences {
  theme: ThemePreference
  /** Light-pool ceiling chosen by the user; `null` means detect automatically. */
  maxWorkers: number | null
  compatibilityMode: boolean
}

const STORAGE_KEY = 'image-compressor:preferences'

const DEFAULTS: StoredPreferences = {
  theme: 'auto',
  maxWorkers: null,
  compatibilityMode: false,
}

/**
 * Validates a parsed localStorage payload, discarding anything malformed so a
 * stale or hand-edited value cannot put the app into a bad state.
 */
export function parseStoredPreferences(value: unknown): StoredPreferences {
  if (typeof value !== 'object' || value === null) return { ...DEFAULTS }
  const record = value as Record<string, unknown>

  const theme =
    record.theme === 'light' ||
    record.theme === 'dark' ||
    record.theme === 'auto'
      ? record.theme
      : DEFAULTS.theme

  const rawWorkers = record.maxWorkers
  const maxWorkers =
    typeof rawWorkers === 'number' &&
    Number.isFinite(rawWorkers) &&
    rawWorkers > 0
      ? Math.round(rawWorkers)
      : null

  return {
    theme,
    maxWorkers,
    compatibilityMode: record.compatibilityMode === true,
  }
}

function load(): StoredPreferences {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === null
      ? { ...DEFAULTS }
      : parseStoredPreferences(JSON.parse(raw))
  } catch {
    return { ...DEFAULTS }
  }
}

const initial = load()

export const themePreference = signal<ThemePreference>(initial.theme)
export const maxWorkers = signal<number | null>(initial.maxWorkers)
export const compatibilityMode = signal<boolean>(initial.compatibilityMode)

const darkQuery =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference === 'auto') return darkQuery?.matches ? 'dark' : 'light'
  return preference
}

export function applyTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolveTheme(preference)
}

function persist(value: StoredPreferences): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage can be unavailable (private mode, quota); preferences stay in
    // memory for the session.
  }
}

// Single reactive pipeline: keep the document theme, the device worker budget,
// and the stored copy in sync whenever any preference changes. Effects run
// immediately on import, so the theme is applied before the first render.
effect(() => {
  const snapshot: StoredPreferences = {
    theme: themePreference.value,
    maxWorkers: maxWorkers.value,
    compatibilityMode: compatibilityMode.value,
  }
  applyTheme(snapshot.theme)
  configureWorkerPreferences(snapshot)
  persist(snapshot)
})

// Follow the OS theme live while the preference is "auto".
darkQuery?.addEventListener?.('change', () => {
  if (themePreference.value === 'auto') applyTheme('auto')
})
