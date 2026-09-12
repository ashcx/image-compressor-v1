export const MAX_WORKERS = 8
export const MAX_WORKERS_HIGH_MEMORY = 16

export interface DeviceSignals {
  hardwareConcurrency?: number
  deviceMemory?: number
  userAgent?: string
  maxTouchPoints?: number
}

export interface DeviceProfile {
  workerCount: number
  constrained: boolean
  maxZipBytes: number
}

const MIB = 1024 * 1024

const IPHONE_MAX_ZIP_BYTES = 512 * MIB
const TABLET_MAX_ZIP_BYTES = 1024 * MIB
const ANDROID_LOW_MEMORY_MAX_ZIP_BYTES = 384 * MIB
const DESKTOP_MAX_ZIP_BYTES = 2 * 1024 * MIB

export function resolveWorkerCount(
  signals: DeviceSignals,
  override?: number,
): number {
  if (isPositiveFinite(override)) {
    return Math.min(override, MAX_WORKERS_HIGH_MEMORY)
  }
  return platformProfile(signals).workerCount
}

export function profileFromSignals(
  signals: DeviceSignals,
  override?: number,
): DeviceProfile {
  const profile = platformProfile(signals)
  if (isPositiveFinite(override)) {
    return { ...profile, workerCount: resolveWorkerCount(signals, override) }
  }
  return profile
}

export function getDeviceProfile(): DeviceProfile {
  const signals: DeviceSignals = {}

  if (typeof navigator !== 'undefined') {
    const nav = navigator as Navigator & { deviceMemory?: number }
    signals.hardwareConcurrency = nav.hardwareConcurrency
    signals.userAgent = nav.userAgent
    signals.maxTouchPoints = nav.maxTouchPoints
    if (typeof nav.deviceMemory === 'number') {
      signals.deviceMemory = nav.deviceMemory
    }
  }

  return profileFromSignals(signals, readWorkerOverride())
}

function platformProfile(signals: DeviceSignals): DeviceProfile {
  const ua = signals.userAgent ?? ''
  const cores = signals.hardwareConcurrency || 4
  const memory = signals.deviceMemory

  if (ua.includes('iPhone')) {
    // Safari exposes no RAM signal, so core count stands in for device class.
    // Phones stay conservative (heavy codecs still halve via heavyWorkerCount).
    return {
      workerCount: phoneWorkerCount(signals.hardwareConcurrency ?? 0),
      constrained: true,
      maxZipBytes: IPHONE_MAX_ZIP_BYTES,
    }
  }

  if (
    ua.includes('iPad') ||
    (ua.includes('Macintosh') && (signals.maxTouchPoints ?? 0) >= 2)
  ) {
    // Low-core iPads are treated like phones (conservative); 7+ reported cores
    // is Pro-class and follows the desktop standard.
    const reported = signals.hardwareConcurrency ?? 0
    const workerCount =
      reported >= 7
        ? Math.min(standardWorkerCount(cores), MAX_WORKERS)
        : phoneWorkerCount(reported)
    return {
      workerCount,
      constrained: true,
      maxZipBytes: TABLET_MAX_ZIP_BYTES,
    }
  }

  if (ua.includes('Android')) {
    if (memory === undefined || memory < 6) {
      return {
        workerCount: 1,
        constrained: true,
        maxZipBytes: ANDROID_LOW_MEMORY_MAX_ZIP_BYTES,
      }
    }
    return {
      workerCount: Math.min(standardWorkerCount(cores), MAX_WORKERS),
      constrained: true,
      maxZipBytes: TABLET_MAX_ZIP_BYTES,
    }
  }

  if (memory !== undefined && memory >= 8) {
    const workerCount =
      cores >= 16 && memory >= 12
        ? Math.min(standardWorkerCount(cores), MAX_WORKERS_HIGH_MEMORY)
        : Math.min(standardWorkerCount(cores), MAX_WORKERS)
    return {
      workerCount,
      constrained: false,
      maxZipBytes: DESKTOP_MAX_ZIP_BYTES,
    }
  }

  if (memory !== undefined && memory < 8) {
    return {
      workerCount: Math.min(standardWorkerCount(cores), 6),
      constrained: true,
      maxZipBytes: TABLET_MAX_ZIP_BYTES,
    }
  }

  return {
    workerCount: Math.min(standardWorkerCount(cores), MAX_WORKERS),
    constrained: false,
    maxZipBytes: DESKTOP_MAX_ZIP_BYTES,
  }
}

/**
 * Heavy codecs (AVIF, compressed PNG) keep large WASM heaps and decoded
 * canvases per worker, so they run with half the standard pool, rounded to the
 * nearest whole worker (floored at 1).
 */
export function heavyWorkerCount(workerCount: number): number {
  return Math.max(1, Math.round(workerCount / 2))
}

/** Standard pool size: hardwareConcurrency - 1, leaving a core for the UI. */
function standardWorkerCount(cores: number): number {
  return Math.max(1, cores - 1)
}

/**
 * Conservative phone-class budget. Safari exposes no RAM signal, so reported
 * cores proxy the device class: 6+ cores → 3, 4-5 → 2, 2 or fewer (or no API)
 * → 1.
 */
function phoneWorkerCount(reported: number): number {
  return reported >= 6 ? 3 : reported >= 4 ? 2 : 1
}

function readWorkerOverride(): number | undefined {
  if (typeof window === 'undefined' || !window.location?.search) {
    return undefined
  }
  const raw = new URLSearchParams(window.location.search).get('workers')
  if (raw === null) {
    return undefined
  }
  const parsed = Number(raw)
  return isPositiveFinite(parsed) ? parsed : undefined
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}
