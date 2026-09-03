import { describe, expect, it } from 'vitest'
import { dateInputToTimestamp, parseTimestamp } from './timestamp'

describe('timestamp conversion', () => {
  it('detects seconds and milliseconds', () => {
    expect(parseTimestamp('0').detectedUnit).toBe('seconds')
    expect(parseTimestamp('1700000000').milliseconds).toBe(1_700_000_000_000)
    expect(parseTimestamp('1700000000000').detectedUnit).toBe('milliseconds')
  })

  it('supports negative timestamps and UTC output', () => {
    const result = parseTimestamp('-1', 'seconds')
    expect(result.milliseconds).toBe(-1000)
    expect(result.utc).toBe('1969-12-31 23:59:59 UTC')
  })

  it('rejects invalid values', () => {
    expect(() => parseTimestamp('hello')).toThrow('有效的数字时间戳')
  })

  it('interprets dates as Beijing time or UTC according to the selected timezone', () => {
    expect(dateInputToTimestamp('2026-09-03 10:46:12', 'beijing').milliseconds)
      .toBe(Date.UTC(2026, 8, 3, 2, 46, 12))
    expect(dateInputToTimestamp('2026-09-03 10:46:12', 'utc').milliseconds)
      .toBe(Date.UTC(2026, 8, 3, 10, 46, 12))
  })

  it('supports slash-separated and date-only input', () => {
    expect(dateInputToTimestamp('2026/09/03 10:46:12', 'utc').milliseconds)
      .toBe(Date.UTC(2026, 8, 3, 10, 46, 12))
    expect(dateInputToTimestamp('2026-09-03', 'beijing').milliseconds)
      .toBe(Date.UTC(2026, 8, 2, 16))
  })

  it('truncates fractional seconds beyond millisecond precision', () => {
    expect(dateInputToTimestamp('2026-09-03 10:46:12.999564051', 'utc').milliseconds)
      .toBe(Date.UTC(2026, 8, 3, 10, 46, 12, 999))
  })

  it('prefers an explicit Z or numeric offset over the selected timezone', () => {
    expect(dateInputToTimestamp('2026-09-03T10:46:12Z', 'beijing').milliseconds)
      .toBe(Date.UTC(2026, 8, 3, 10, 46, 12))
    expect(dateInputToTimestamp('2026-09-03 10:46:12+0800', 'utc').milliseconds)
      .toBe(Date.UTC(2026, 8, 3, 2, 46, 12))
    expect(dateInputToTimestamp('2026-09-03 10:46:12-05:30', 'beijing').milliseconds)
      .toBe(Date.UTC(2026, 8, 3, 16, 16, 12))
  })

  it('rejects unsupported formats and impossible dates instead of normalizing them', () => {
    expect(() => dateInputToTimestamp('2026年09月03日')).toThrow('不支持的日期格式')
    expect(() => dateInputToTimestamp('2026-02-29 10:00:00')).toThrow('日期不存在')
    expect(() => dateInputToTimestamp('2026-09-03 24:00:00')).toThrow('超出有效范围')
    expect(() => dateInputToTimestamp('2026-09-03T10:00:00+15:00')).toThrow('时区偏移无效')
  })
})
