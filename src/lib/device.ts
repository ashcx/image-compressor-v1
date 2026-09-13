const MAX_WORKERS = 8
export const MAX_WORKERS_HIGH_MEMORY = 16

export interface DeviceSignals {
  hardwareConcurrency?: number
  deviceMemory?: number
  userAgent?: string
  maxTouchPoints?: number
}

/** Maximum decoded canvas the browser can hold, in CSS pixels. */
export interface CanvasLimits {
  maxSide: number
  maxArea: number
}

export interface DeviceProfile {
  workerCount: number
  /** Heavy-codec pool size (AVIF, compressed PNG). iOS pins this to one. */
  heavyWorkerCount: number
  maxZipBytes: number
  /**
   * Total decoded-canvas memory the scheduler may keep in flight, in bytes.
   * `0` disables gating (desktop is deliberately uncapped).
   */
  canvasMemoryBudget: number
  canvasLimits: CanvasLimits
}

const MIB = 1024 * 1024
const GIB = 1024 * MIB

const IPHONE_MAX_ZIP_BYTES = 512 * MIB
const TABLET_MAX_ZIP_BYTES = 1024 * MIB
const ANDROID_LOW_MEMORY_MAX_ZIP_BYTES = 384 * MIB
const DESKTOP_MAX_ZIP_BYTES = 2 * 1024 * MIB

// Canvas pixel-memory budgets. iOS Safari exposes no RAM signal, so phone and
// base iPad get a blanket cap; 7+-core iPads (practically Pro) get more.
const IPHONE_CANVAS_BUDGET = 512 * MIB
const IPAD_CANVAS_BUDGET = 512 * MIB
const IPAD_PRO_CANVAS_BUDGET = 1024 * MIB
const ANDROID_CANVAS_BUDGET = 512 * MIB
const DESKTOP_FALLBACK_CANVAS_BUDGET = 2048 * MIB

// Engine canvas ceilings. WebKit iOS raised its per-axis limit to 8192 in
// Safari 17.4 (WebKit bug 271002); older iOS was 4096. Blink is area-shaped
// (32768 x 8192), Gecko is per-axis 32767, macOS WebKit is 16384 squared.
const IOS_CANVAS_SIDE = 8192
const IOS_CANVAS_AREA = 8192 * 8192
const IOS_LEGACY_CANVAS_SIDE = 4096
const IOS_LEGACY_CANVAS_AREA = 4096 * 4096
const BLINK_CANVAS_SIDE = 65_535
const BLINK_CANVAS_AREA = 32_768 * 8_192
const GECKO_CANVAS_SIDE = 32_767
const WEBKIT_MAC_CANVAS_SIDE = 16_384
const WEBKIT_MAC_CANVAS_AREA = 16_384 * 16_384
const UNKNOWN_CANVAS_SIDE = 8192
const UNKNOWN_CANVAS_AREA = 8192 * 8192

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
    const workerCount = resolveWorkerCount(signals, override)
    return {
      ...profile,
      workerCount,
      heavyWorkerCount: isIos(signals) ? 1 : heavyWorkerCount(workerCount),
    }
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
  const canvasLimits = platformCanvasLimits(signals)

  let workerCount: number
  let maxZipBytes: number
  let canvasMemoryBudget: number

  if (ua.includes('iPhone')) {
    // Safari exposes no RAM signal, so core count stands in for device class.
    workerCount = phoneWorkerCount(signals.hardwareConcurrency ?? 0)
    maxZipBytes = IPHONE_MAX_ZIP_BYTES
    canvasMemoryBudget = IPHONE_CANVAS_BUDGET
  } else if (
    ua.includes('iPad') ||
    (ua.includes('Macintosh') && (signals.maxTouchPoints ?? 0) >= 2)
  ) {
    // Low-core iPads are treated like phones (conservative); 7+ reported cores
    // is Pro-class and follows the desktop standard.
    const reported = signals.hardwareConcurrency ?? 0
    workerCount =
      reported >= 7
        ? Math.min(standardWorkerCount(cores), MAX_WORKERS)
        : phoneWorkerCount(reported)
    maxZipBytes = TABLET_MAX_ZIP_BYTES
    canvasMemoryBudget =
      workerCount >= 6 ? IPAD_PRO_CANVAS_BUDGET : IPAD_CANVAS_BUDGET
  } else if (ua.includes('Android')) {
    if (memory === undefined || memory < 6) {
      workerCount = 1
      maxZipBytes = ANDROID_LOW_MEMORY_MAX_ZIP_BYTES
      canvasMemoryBudget = ANDROID_CANVAS_BUDGET
    } else {
      workerCount = Math.min(standardWorkerCount(cores), MAX_WORKERS)
      maxZipBytes = TABLET_MAX_ZIP_BYTES
      canvasMemoryBudget = androidCanvasBudget(memory)
    }
  } else if (memory !== undefined && memory >= 8) {
    workerCount =
      cores >= 16 && memory >= 12
        ? Math.min(standardWorkerCount(cores), MAX_WORKERS_HIGH_MEMORY)
        : Math.min(standardWorkerCount(cores), MAX_WORKERS)
    maxZipBytes = DESKTOP_MAX_ZIP_BYTES
    canvasMemoryBudget = desktopCanvasBudget(memory)
  } else if (memory !== undefined && memory < 8) {
    workerCount = Math.min(standardWorkerCount(cores), 6)
    maxZipBytes = TABLET_MAX_ZIP_BYTES
    canvasMemoryBudget = desktopCanvasBudget(memory)
  } else {
    workerCount = Math.min(standardWorkerCount(cores), MAX_WORKERS)
    maxZipBytes = DESKTOP_MAX_ZIP_BYTES
    canvasMemoryBudget = DESKTOP_FALLBACK_CANVAS_BUDGET
  }

  return {
    workerCount,
    heavyWorkerCount: isIos(signals) ? 1 : heavyWorkerCount(workerCount),
    maxZipBytes,
    canvasMemoryBudget,
    canvasLimits,
  }
}

/** Engine canvas ceiling for the detected browser, with a conservative default. */
export function platformCanvasLimits(signals: DeviceSignals): CanvasLimits {
  const ua = signals.userAgent ?? ''

  if (isIphone(ua) || isIpad(ua, signals.maxTouchPoints ?? 0)) {
    return iosCanvasLimits(ua)
  }
  if (ua.includes('Firefox')) {
    return { maxSide: GECKO_CANVAS_SIDE, maxArea: Number.POSITIVE_INFINITY }
  }
  if (
    ua.includes('Chrome') ||
    ua.includes('Chromium') ||
    ua.includes('Edg') ||
    ua.includes('OPR') ||
    ua.includes('Android')
  ) {
    return { maxSide: BLINK_CANVAS_SIDE, maxArea: BLINK_CANVAS_AREA }
  }
  if (ua.includes('Safari')) {
    return { maxSide: WEBKIT_MAC_CANVAS_SIDE, maxArea: WEBKIT_MAC_CANVAS_AREA }
  }
  return { maxSide: UNKNOWN_CANVAS_SIDE, maxArea: UNKNOWN_CANVAS_AREA }
}

/**
 * Heavy codecs (AVIF, compressed PNG) keep large WASM heaps and decoded
 * canvases per worker, so they run with half the standard pool, rounded to the
 * nearest whole worker (floored at 1). iOS pins heavy work to a single worker:
 * even one AVIF encode can exhaust a tablet's canvas memory budget.
 */
export function heavyWorkerCount(workerCount: number): number {
  return Math.max(1, Math.round(workerCount / 2))
}

function isIphone(ua: string): boolean {
  return ua.includes('iPhone')
}

function isIpad(ua: string, maxTouchPoints: number): boolean {
  return (
    ua.includes('iPad') || (ua.includes('Macintosh') && maxTouchPoints >= 2)
  )
}

function isIos(signals: DeviceSignals): boolean {
  const ua = signals.userAgent ?? ''
  return isIphone(ua) || isIpad(ua, signals.maxTouchPoints ?? 0)
}

/**
 * iOS Safari 17.4 raised the canvas limit to 8192 per axis. The version is only
 * discoverable from the UA: iPhones report `OS 17_4`, while iPads (and iPads
 * masquerading as Macintosh) report the `Version/17.4` token.
 */
function iosCanvasLimits(ua: string): CanvasLimits {
  const version =
    /OS (\d+)[._](\d+)/.exec(ua) ?? /Version\/(\d+)[._](\d+)/.exec(ua)
  const legacy =
    version !== null &&
    (Number(version[1]) < 17 ||
      (Number(version[1]) === 17 && Number(version[2]) < 4))
  return legacy
    ? { maxSide: IOS_LEGACY_CANVAS_SIDE, maxArea: IOS_LEGACY_CANVAS_AREA }
    : { maxSide: IOS_CANVAS_SIDE, maxArea: IOS_CANVAS_AREA }
}

function androidCanvasBudget(deviceMemory: number): number {
  if (deviceMemory >= 8) {
    return Math.max(ANDROID_CANVAS_BUDGET, (deviceMemory * GIB) / 6)
  }
  return ANDROID_CANVAS_BUDGET
}

function desktopCanvasBudget(deviceMemory: number): number {
  return Math.max(DESKTOP_FALLBACK_CANVAS_BUDGET, (deviceMemory * GIB) / 2)
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
