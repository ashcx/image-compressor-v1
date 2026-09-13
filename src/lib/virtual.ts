export const DEFAULT_ROW_HEIGHT = 64
export const DEFAULT_ROW_GAP = 8
export const DEFAULT_OVERSCAN = 4

export interface VirtualWindow {
  /** First rendered index (inclusive). */
  start: number
  /** Last rendered index (exclusive). */
  end: number
}

export interface VirtualWindowParams {
  count: number
  rowHeight: number
  gap: number
  viewportHeight: number
  scrollTop: number
  overscan?: number
}

/** Total scroll height for a list of equal-height rows with gaps between. */
export function listHeight(
  count: number,
  rowHeight: number,
  gap: number,
): number {
  if (count <= 0) return 0
  return count * rowHeight + (count - 1) * gap
}

/** Pixel offset of a row from the top of the list. */
export function rowOffset(
  index: number,
  rowHeight: number,
  gap: number,
): number {
  return index * (rowHeight + gap)
}

/**
 * Computes the half-open range of row indices to mount for the current scroll
 * position, including an overscan buffer on both sides. Pure and clamped so it
 * is safe for empty lists, zero-height viewports, and over-scrolled positions.
 */
export function computeWindow(params: VirtualWindowParams): VirtualWindow {
  const { count, rowHeight, gap, viewportHeight, scrollTop } = params
  const stride = rowHeight + gap
  if (count <= 0 || stride <= 0) return { start: 0, end: 0 }

  const maxScroll = Math.max(
    0,
    listHeight(count, rowHeight, gap) - viewportHeight,
  )
  const clamped = Math.max(0, Math.min(scrollTop, maxScroll))
  const first = Math.floor(clamped / stride)
  const visible = Math.max(1, Math.ceil(viewportHeight / stride) + 1)
  const overscan = Math.max(0, params.overscan ?? DEFAULT_OVERSCAN)
  const start = Math.max(0, first - overscan)
  const end = Math.min(count, first + visible + overscan)
  return { start, end }
}
