import type { ConfigTableRange } from '../../shared/types'

export const MAX_FROZEN_ROWS = 50
export const MAX_FROZEN_COLUMNS = 50

export interface ConfigTableRangeRequest {
  startRow: number
  rowCount: number
  startColumn: number
  columnCount: number
}

export function clampFrozenCount(value: number, total: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(0, Math.floor(value)), Math.max(0, total), maximum)
}

export function visibleGridIndexes(firstVisible: number, visibleCount: number, frozenCount: number, total: number): number[] {
  const indexes = new Set<number>()
  for (let index = 1; index <= Math.min(frozenCount, total); index += 1) indexes.add(index)
  for (let index = Math.max(1, firstVisible); index <= Math.min(total, firstVisible + visibleCount - 1); index += 1) indexes.add(index)
  return [...indexes].sort((left, right) => left - right)
}

export function configTableRangeRequests(startRow: number, startColumn: number, frozenRows: number, frozenColumns: number): ConfigTableRangeRequest[] {
  const requests = new Map<string, ConfigTableRangeRequest>()
  const contains = (outer: ConfigTableRangeRequest, inner: ConfigTableRangeRequest) => outer.startRow <= inner.startRow
    && outer.startRow + outer.rowCount >= inner.startRow + inner.rowCount
    && outer.startColumn <= inner.startColumn
    && outer.startColumn + outer.columnCount >= inner.startColumn + inner.columnCount
  const add = (request: ConfigTableRangeRequest) => {
    if ([...requests.values()].some((existing) => contains(existing, request))) return
    for (const [key, existing] of requests) {
      if (contains(request, existing)) requests.delete(key)
    }
    requests.set(`${request.startRow}:${request.rowCount}:${request.startColumn}:${request.columnCount}`, request)
  }
  add({ startRow, rowCount: 100, startColumn, columnCount: 30 })
  if (frozenRows > 0) add({ startRow: 1, rowCount: frozenRows, startColumn, columnCount: 30 })
  if (frozenColumns > 0) add({ startRow, rowCount: 100, startColumn: 1, columnCount: frozenColumns })
  if (frozenRows > 0 && frozenColumns > 0) add({ startRow: 1, rowCount: frozenRows, startColumn: 1, columnCount: frozenColumns })
  return [...requests.values()]
}

export function configTableRangeValue(ranges: ConfigTableRange[], row: number, column: number): string {
  for (const range of ranges) {
    const rowOffset = row - range.startRow
    const columnOffset = column - range.startColumn
    if (rowOffset >= 0 && rowOffset < range.rowCount && columnOffset >= 0 && columnOffset < range.columnCount) {
      return range.values[rowOffset]?.[columnOffset] ?? ''
    }
  }
  return ''
}
