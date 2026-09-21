import type { OutputFormat } from './types'

export type ControlKey = 'quality' | 'effort' | 'speed' | 'mode'

interface ControlBase {
  key: ControlKey
  label: string
  hint?: string
  /** Rendered in the primary settings area instead of the advanced section. */
  primary?: boolean
}

export interface RangeControl extends ControlBase {
  kind: 'range'
  min: number
  max: number
  step: number
  default: number
}

export interface SelectOption {
  label: string
  value: number
  hint?: string
}

export interface SelectControl extends ControlBase {
  kind: 'select'
  options: SelectOption[]
  default: number
}

export type FormatControl = RangeControl | SelectControl

export interface FormatSpec {
  format: OutputFormat
  label: string
  mimeType: string
  extension: string
  lossless: boolean
  controls: FormatControl[]
}

export const FORMAT_ORDER: OutputFormat[] = [
  'jpeg',
  'png',
  'webp',
  'avif',
  'heic',
]

const QUALITY_PRESETS: SelectControl = {
  kind: 'select',
  key: 'quality',
  label: 'Quality',
  options: [
    {
      label: 'Best',
      value: 94,
      hint: 'Largest file. Very high quality is often redundant for photos — big files with little perceivable gain.',
    },
    { label: 'Better', value: 85 },
    { label: 'Default', value: 75 },
    { label: 'Low', value: 50, hint: 'Smallest file, visible trade-off.' },
  ],
  default: 75,
}

/**
 * HEIC maps quality straight onto a HEVC QP (quality 100 = QP 0, 0 = QP 51),
 * a far higher scale than JPEG's. These values are calibrated to land near the
 * JPEG presets in measured PSNR, so HEIC "Default" looks like JPEG "Default"
 * without the ~2x file-size blow-up that reusing the JPEG numbers caused.
 */
const HEIC_QUALITY_PRESETS: SelectControl = {
  kind: 'select',
  key: 'quality',
  label: 'Quality',
  options: [
    {
      label: 'Best',
      value: 80,
      hint: 'Visually lossless HEVC (QP 10). Still much smaller than the old HEIC Best.',
    },
    { label: 'Better', value: 58 },
    { label: 'Default', value: 51 },
    { label: 'Low', value: 43, hint: 'Smallest file, visible trade-off.' },
  ],
  default: 51,
}

/**
 * WebP's 0-100 scale is not comparable to JPEG's; reusing the JPEG numbers made
 * WebP systematically lower quality at the same label. These values are
 * calibrated so each label tracks the JPEG preset in measured PSNR/SSIM while
 * staying smaller (Chrome's native encoder).
 */
const WEBP_QUALITY_PRESETS: SelectControl = {
  kind: 'select',
  key: 'quality',
  label: 'Quality',
  options: [
    {
      label: 'Best',
      value: 98,
      hint: 'Largest file. WebP lossy tops out near 99; 100 switches to lossless and balloons the file.',
    },
    { label: 'Better', value: 92 },
    { label: 'Default', value: 85 },
    { label: 'Low', value: 70, hint: 'Smallest file, visible trade-off.' },
  ],
  default: 85,
}

/**
 * AVIF's quality scale is not comparable to JPEG's either. These values track
 * the JPEG presets in measured PSNR while staying smaller, and stop short of
 * AVIF 100, which jumps to a near-lossless ~5x file.
 */
const AVIF_QUALITY_PRESETS: SelectControl = {
  kind: 'select',
  key: 'quality',
  label: 'Quality',
  options: [
    {
      label: 'Best',
      value: 95,
      hint: 'Near-lossless. AVIF 100 jumps to a much larger file for little visible gain.',
    },
    { label: 'Better', value: 85 },
    { label: 'Default', value: 75 },
    { label: 'Low', value: 58, hint: 'Smallest file, visible trade-off.' },
  ],
  default: 75,
}

export const FORMAT_SPECS: Record<OutputFormat, FormatSpec> = {
  jpeg: {
    format: 'jpeg',
    label: 'JPEG',
    mimeType: 'image/jpeg',
    extension: 'jpg',
    lossless: false,
    controls: [QUALITY_PRESETS],
  },
  png: {
    format: 'png',
    label: 'PNG',
    mimeType: 'image/png',
    extension: 'png',
    lossless: true,
    controls: [
      {
        kind: 'select',
        key: 'mode',
        label: 'Compression',
        default: 0,
        options: [
          {
            label: 'Uncompressed',
            value: 0,
            hint: 'Fastest. Native PNG, lossless.',
          },
          {
            label: 'Lossless Compressed (slow)',
            value: 1,
            hint: 'Slow to process, but fully lossless (30–50% smaller).',
          },
          {
            label: 'Compressed (best for graphics, slowest)',
            value: 2,
            hint: 'Slow. Not recommended for photos — use JPEG for those. Can be acceptable for graphics with solid colours.',
          },
        ],
      },
    ],
  },
  webp: {
    format: 'webp',
    label: 'WebP',
    mimeType: 'image/webp',
    extension: 'webp',
    lossless: false,
    controls: [
      WEBP_QUALITY_PRESETS,
      {
        kind: 'select',
        key: 'speed',
        label: 'Speed',
        default: 0,
        hint: 'Native WebP can produce smaller files, but takes longer when the browser supports it.',
        options: [
          {
            label: 'Fast',
            value: 0,
            hint: 'Fast libwebp WebAssembly encoding.',
          },
          {
            label: 'Smaller size (slower)',
            value: 1,
            hint: 'Uses the native browser WebP encoder when available; otherwise falls back to Fast.',
          },
        ],
      },
    ],
  },
  avif: {
    format: 'avif',
    label: 'AVIF (slower)',
    mimeType: 'image/avif',
    extension: 'avif',
    lossless: false,
    controls: [
      AVIF_QUALITY_PRESETS,
      {
        kind: 'select',
        key: 'speed',
        label: 'Speed',
        default: 10,
        hint: 'Slower speeds compress more but take much longer.',
        options: [
          { label: 'Default', value: 10 },
          { label: 'Slow (slightly smaller size)', value: 8 },
          { label: 'Slowest (smallest size)', value: 6 },
        ],
      },
    ],
  },
  heic: {
    format: 'heic',
    label: 'HEIC (slowest)',
    mimeType: 'image/heic',
    extension: 'heic',
    lossless: false,
    controls: [
      HEIC_QUALITY_PRESETS,
      {
        kind: 'select',
        key: 'speed',
        label: 'Speed',
        default: 0,
        primary: true,
        hint: 'HEIC uses the quickest kvazaar preset. More speed options may be added later.',
        options: [
          {
            label: 'Default',
            value: 0,
            hint: 'Quickest encode (kvazaar ultrafast).',
          },
        ],
      },
    ],
  },
}

export const SUPPORTED_FORMAT_LABELS = FORMAT_ORDER.map((format) =>
  FORMAT_SPECS[format].mimeType.replace(/^image\//, '').toUpperCase(),
)

export function listFormatLabels(
  labels: string[] = SUPPORTED_FORMAT_LABELS,
): string {
  if (labels.length < 2) return labels[0] ?? ''
  if (labels.length === 2) return labels.join(' and ')
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`
}

/**
 * Heavy codecs keep a large WASM heap and decoded canvas per worker, so they
 * run on a reduced (halved) worker pool. AVIF always qualifies; PNG qualifies
 * for both compressed modes (oxipng lossless and quantised lossy) but not the
 * native uncompressed path.
 */
export function isHeavyFormat(format: OutputFormat, mode: number): boolean {
  if (format === 'avif') return true
  if (format === 'heic') return true
  if (format === 'png') return mode >= 1
  return false
}
