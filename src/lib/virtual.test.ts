import { describe, expect, it } from 'vitest'
import { computeWindow, listHeight, rowOffset } from './virtual'

const base = {
  rowHeight: 64,
  gap: 8,
  viewportHeight: 640,
  overscan: 4,
}

describe('listHeight', () => {
  it('accounts for gaps between rows only', () => {
    expect(listHeight(0, 64, 8)).toBe(0)
    expect(listHeight(1, 64, 8)).toBe(64)
    expect(listHeight(3, 64, 8)).toBe(64 * 3 + 8 * 2)
  })
})

describe('rowOffset', () => {
  it('places rows on a fixed stride', () => {
    expect(rowOffset(0, 64, 8)).toBe(0)
    expect(rowOffset(5, 64, 8)).toBe(5 * 72)
  })
})

describe('computeWindow', () => {
  it('returns an empty window for an empty list', () => {
    expect(computeWindow({ ...base, count: 0, scrollTop: 0 })).toEqual({
      start: 0,
      end: 0,
    })
  })

  it('renders the top window with overscan', () => {
    const win = computeWindow({ ...base, count: 1000, scrollTop: 0 })
    expect(win.start).toBe(0)
    // ceil(640/72)+1 = 10 visible, plus 4 overscan.
    expect(win.end).toBe(14)
  })

  it('slides the window with scroll position', () => {
    const win = computeWindow({ ...base, count: 1000, scrollTop: 720 })
    expect(win.start).toBe(6)
    expect(win.end).toBe(24)
  })

  it('clamps at the end of the list', () => {
    const win = computeWindow({ ...base, count: 20, scrollTop: 100000 })
    expect(win.end).toBe(20)
    expect(win.start).toBeLessThan(20)
  })

  it('honours a custom overscan and zero overscan', () => {
    const none = computeWindow({
      ...base,
      count: 1000,
      scrollTop: 720,
      overscan: 0,
    })
    expect(none.start).toBe(10)
    const wide = computeWindow({
      ...base,
      count: 1000,
      scrollTop: 720,
      overscan: 10,
    })
    expect(wide.start).toBe(0)
  })

  it('mounts only a small window for a large list', () => {
    const win = computeWindow({ ...base, count: 1000, scrollTop: 36000 })
    expect(win.end - win.start).toBeLessThan(25)
  })
})
