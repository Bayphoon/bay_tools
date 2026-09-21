import { describe, expect, it } from 'vitest'
import { clampFrozenCount, configTableRangeRequests, configTableRangeValue, visibleGridIndexes } from './configTableViewport'

describe('config table viewport', () => {
  it('keeps multiple frozen indexes together with the scrolled viewport', () => {
    expect(visibleGridIndexes(20, 4, 3, 30)).toEqual([1, 2, 3, 20, 21, 22, 23])
    expect(visibleGridIndexes(2, 4, 3, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('clamps frozen row and column counts', () => {
    expect(clampFrozenCount(-2, 10, 50)).toBe(0)
    expect(clampFrozenCount(8.9, 6, 50)).toBe(6)
    expect(clampFrozenCount(80, 100, 50)).toBe(50)
  })

  it('requests the visible, frozen-row, frozen-column and corner ranges without duplicates', () => {
    expect(configTableRangeRequests(40, 12, 3, 2)).toEqual([
      { startRow: 40, rowCount: 100, startColumn: 12, columnCount: 30 },
      { startRow: 1, rowCount: 3, startColumn: 12, columnCount: 30 },
      { startRow: 40, rowCount: 100, startColumn: 1, columnCount: 2 },
      { startRow: 1, rowCount: 3, startColumn: 1, columnCount: 2 },
    ])
    expect(configTableRangeRequests(1, 1, 3, 2)).toEqual([{ startRow: 1, rowCount: 100, startColumn: 1, columnCount: 30 }])
  })

  it('reads a cell from any loaded range', () => {
    expect(configTableRangeValue([{ sheet: 'Sheet1', startRow: 10, startColumn: 5, rowCount: 2, columnCount: 2, values: [['A', 'B'], ['C', 'D']] }], 11, 6)).toBe('D')
  })
})
