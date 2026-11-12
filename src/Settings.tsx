import { useEffect, useState } from 'preact/hooks'
import { FORMAT_ORDER } from './lib/codecs/formats'
import {
  canEncodeNatively,
  describeDecoder,
  describeRenderer,
} from './lib/codecs/registry'
import {
  describePlatform,
  getAutoWorkerCount,
  getDeviceProfile,
  getDeviceSignals,
} from './lib/device'
import { formatBytes } from './lib/format'
import {
  applyTheme,
  compatibilityMode,
  maxWorkers,
  type ThemePreference,
  themePreference,
} from './lib/preferences'
import { MAX_WORKING_PIXELS } from './lib/resize'
import { appVersion } from './lib/version'

interface StatRow {
  label: string
  value: string
}

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'auto', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number
}

interface WindowWithDirectoryPicker extends Window {
  showDirectoryPicker?: () => Promise<unknown>
}

function canvasAreaLabel(area: number): string {
  return Number.isFinite(area) ? `${area.toLocaleString()} px²` : 'unbounded'
}

/** Native codec availability plus the platform APIs the app can use. */
async function capabilityRows(): Promise<StatRow[]> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const memory = (nav as NavigatorWithMemory | undefined)?.deviceMemory
  const storage = nav?.storage as
    | (StorageManager & { getDirectory?: () => Promise<unknown> })
    | undefined
  const picker =
    typeof window === 'undefined'
      ? undefined
      : (window as WindowWithDirectoryPicker).showDirectoryPicker

  const [jpeg, png, webp] = await Promise.all([
    canEncodeNatively('image/jpeg'),
    canEncodeNatively('image/png'),
    canEncodeNatively('image/webp'),
  ])

  return [
    {
      label: 'WebAssembly',
      value: typeof WebAssembly === 'undefined' ? 'No' : 'Yes',
    },
    {
      label: 'OffscreenCanvas',
      value: typeof OffscreenCanvas === 'undefined' ? 'No' : 'Yes',
    },
    { label: 'Native JPEG encoder', value: jpeg ? 'Yes' : 'No' },
    { label: 'Native PNG encoder', value: png ? 'Yes' : 'No' },
    { label: 'Native WebP encoder', value: webp ? 'Yes' : 'No' },
    {
      label: 'File System Access (save to folder)',
      value: typeof picker === 'function' ? 'Yes' : 'No',
    },
    {
      label: 'Origin private file system',
      value: typeof storage?.getDirectory === 'function' ? 'Yes' : 'No',
    },
    {
      label: 'navigator.deviceMemory',
      value:
        typeof memory === 'number'
          ? `${memory} GB`
          : 'Not exposed by this browser',
    },
  ]
}

/** Encoder backend per output format (PNG is listed per compression mode). */
async function encoderRows(): Promise<StatRow[]> {
  const [jpeg, pngNative, pngLossless, pngLossy, webpDefault, webpSmall] =
    await Promise.all([
      describeRenderer('jpeg'),
      describeRenderer('png', 0),
      describeRenderer('png', 1),
      describeRenderer('png', 2),
      describeRenderer('webp', undefined, 0),
      describeRenderer('webp', undefined, 1),
    ])

  return [
    { label: 'JPEG', value: jpeg },
    { label: 'PNG · uncompressed', value: pngNative },
    { label: 'PNG · lossless', value: pngLossless },
    { label: 'PNG · lossy', value: pngLossy },
    { label: 'WebP · default', value: webpDefault },
    { label: 'WebP · smaller', value: webpSmall },
    { label: 'AVIF', value: await describeRenderer('avif') },
    { label: 'HEIC', value: await describeRenderer('heic') },
  ]
}

/** Decoder backend per input format; native decode is probed per browser. */
async function decoderRows(): Promise<StatRow[]> {
  return Promise.all(
    FORMAT_ORDER.map(async (format) => ({
      label: format.toUpperCase(),
      value: await describeDecoder(format),
    })),
  )
}

function StatsRow({ row }: { row: StatRow }) {
  return (
    <div class="stats__row">
      <dt>{row.label}</dt>
      <dd>{row.value}</dd>
    </div>
  )
}

function StatsGroup({ title, rows }: { title: string; rows: StatRow[] }) {
  return (
    <div class="stats-group">
      <h3>{title}</h3>
      <dl class="stats">
        {rows.map((row) => (
          <StatsRow row={row} key={row.label} />
        ))}
      </dl>
    </div>
  )
}

function BackIcon() {
  return (
    <svg class="button__icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M12 5.5 7.5 10l4.5 4.5" />
      <path d="M7.5 10H16" />
    </svg>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      class={`chevron-icon${open ? ' chevron-icon--open' : ''}`}
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path d="m5 7.5 5 5 5-5" />
    </svg>
  )
}

export function SettingsPage({
  onClose,
  onWorkerSettingsChange,
}: {
  onClose: () => void
  onWorkerSettingsChange: () => void
}) {
  const [asyncStats, setAsyncStats] = useState<{
    encoders: StatRow[]
    decoders: StatRow[]
    capabilities: StatRow[]
  }>({ encoders: [], decoders: [], capabilities: [] })
  const [statsOpen, setStatsOpen] = useState(false)

  useEffect(() => {
    let active = true
    void Promise.all([encoderRows(), decoderRows(), capabilityRows()]).then(
      ([encoders, decoders, capabilities]) => {
        if (active) setAsyncStats({ encoders, decoders, capabilities })
      },
    )
    return () => {
      active = false
    }
  }, [])

  const signals = getDeviceSignals()
  const platform = describePlatform(signals)
  const profile = getDeviceProfile()
  const autoWorkers = Math.max(1, getAutoWorkerCount())
  const compat = compatibilityMode.value
  const selectedWorkers = compat
    ? 1
    : Math.min(maxWorkers.value ?? autoWorkers, autoWorkers)

  const deviceSummaryRows: StatRow[] = [
    { label: 'Device', value: `${platform.deviceType} · ${platform.os}` },
    {
      label: 'Browser',
      value: platform.browserVersion
        ? `${platform.browser} ${platform.browserVersion}`
        : platform.browser,
    },
    {
      label: 'CPU cores (reported)',
      value: signals.hardwareConcurrency
        ? String(signals.hardwareConcurrency)
        : 'Not exposed',
    },
    {
      label: 'Device memory',
      value:
        typeof signals.deviceMemory === 'number'
          ? `${signals.deviceMemory} GB`
          : 'Not exposed',
    },
    { label: 'App version', value: appVersion },
  ]

  const deviceDetailRows: StatRow[] = [
    {
      label: 'Working-resolution cap',
      value: `${(MAX_WORKING_PIXELS / 1_000_000).toLocaleString()} MP before device/browser limits`,
    },
    {
      label: 'Canvas ceiling',
      value: `${profile.canvasLimits.maxSide.toLocaleString()} px max side · ${canvasAreaLabel(profile.canvasLimits.maxArea)}`,
    },
    {
      label: 'Canvas memory budget',
      value: formatBytes(profile.canvasMemoryBudget),
    },
    { label: 'Archive (ZIP) budget', value: formatBytes(profile.maxZipBytes) },
    {
      label: 'Workers',
      value: `${profile.workerCount} light · ${profile.heavyWorkerCount} heavy`,
    },
  ]

  const deviceRows = statsOpen
    ? [...deviceSummaryRows, ...deviceDetailRows]
    : deviceSummaryRows

  return (
    <div class="settings-page">
      <header class="settings-page__header">
        <button
          type="button"
          class="settings-back"
          aria-label="Back"
          title="Back"
          onClick={onClose}
        >
          <BackIcon />
        </button>
        <h1>Settings</h1>
      </header>

      <section class="settings-card" aria-labelledby="settings-appearance">
        <h2 id="settings-appearance">Appearance</h2>
        <div class="field">
          <span class="field__label">Theme</span>
          <div class="segmented">
            {THEME_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                aria-pressed={themePreference.value === option.value}
                class={
                  themePreference.value === option.value
                    ? 'segmented__option segmented__option--active'
                    : 'segmented__option'
                }
                onClick={() => {
                  themePreference.value = option.value
                  applyTheme(option.value)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span class="field__hint">
            System follows your operating system's light or dark setting.
          </span>
        </div>
      </section>

      <section class="settings-card" aria-labelledby="settings-performance">
        <h2 id="settings-performance">Performance</h2>
        <label class="field">
          <span class="field__label">
            Maximum workers: {compat ? 1 : selectedWorkers}
            {!compat && selectedWorkers >= autoWorkers ? ' (auto)' : ''}
          </span>
          <input
            type="range"
            min={1}
            max={autoWorkers}
            step={1}
            value={selectedWorkers}
            disabled={compat}
            aria-label="Maximum workers"
            onInput={(event) => {
              maxWorkers.value = Number(event.currentTarget.value)
              onWorkerSettingsChange()
            }}
          />
          <span class="field__hint">
            Images are processed in parallel across workers. Higher values are
            faster on capable devices; lower values leave more headroom for the
            rest of your system. Heavy formats (AVIF, compressed PNG, HEIC) use
            fewer workers because each one needs more memory.
          </span>
        </label>

        <label class="toggle">
          <input
            type="checkbox"
            checked={compat}
            onChange={(event) => {
              compatibilityMode.value = event.currentTarget.checked
              onWorkerSettingsChange()
            }}
          />
          <span class="toggle__text">
            <strong>Compatibility mode</strong>
            <span class="field__hint">
              Limits processing to a single image at a time. Use this if your
              device runs out of memory or the tab crashes during large batches.
              It reduces processing speed.
            </span>
          </span>
        </label>
      </section>

      <section class="settings-card" aria-labelledby="settings-stats">
        <h2 id="settings-stats">Stats for nerds</h2>
        <StatsGroup title="Device" rows={deviceRows} />
        {statsOpen && (
          <>
            <StatsGroup
              title="Encoder backend by format"
              rows={asyncStats.encoders}
            />
            <StatsGroup
              title="Decoder backend by format"
              rows={asyncStats.decoders}
            />
            <StatsGroup title="Capabilities" rows={asyncStats.capabilities} />
          </>
        )}
        <button
          type="button"
          class="stats-toggle"
          aria-expanded={statsOpen}
          onClick={() => setStatsOpen((open) => !open)}
        >
          <span>{statsOpen ? 'Show less' : 'Show more'}</span>
          <ChevronIcon open={statsOpen} />
        </button>
      </section>
    </div>
  )
}
