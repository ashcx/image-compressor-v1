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
    return {
      workerCount: 1,
      constrained: true,
      maxZipBytes: IPHONE_MAX_ZIP_BYTES,
    }
  }

  if (
    ua.includes('iPad') ||
    (ua.includes('Macintosh') && (signals.maxTouchPoints ?? 0) >= 2)
  ) {
    // Temporary tier until Sprint 8.1 identifies iPad Pro models directly:
    // 6 cores or fewer is treated as a base iPad, more as a Pro-class device.
    const workerCount =
      cores <= 6
        ? Math.max(1, Math.min(cores, 4))
        : Math.max(1, Math.min(cores, MAX_WORKERS))
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
      workerCount: Math.max(1, Math.min(cores, 4)),
      constrained: true,
      maxZipBytes: TABLET_MAX_ZIP_BYTES,
    }
  }

  if (memory !== undefined && memory >= 8) {
    const workerCount =
      cores >= 16 && memory >= 12
        ? Math.min(cores, MAX_WORKERS_HIGH_MEMORY)
        : Math.min(cores, MAX_WORKERS)
    return {
      workerCount,
      constrained: false,
      maxZipBytes: DESKTOP_MAX_ZIP_BYTES,
    }
  }

  if (memory !== undefined && memory < 8) {
    return {
      workerCount: Math.max(1, Math.min(cores, 6)),
      constrained: true,
      maxZipBytes: TABLET_MAX_ZIP_BYTES,
    }
  }

  return {
    workerCount: Math.min(cores, MAX_WORKERS),
    constrained: false,
    maxZipBytes: DESKTOP_MAX_ZIP_BYTES,
  }
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
