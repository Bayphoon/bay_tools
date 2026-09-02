import { describe, expect, it } from 'vitest'
import { parseTimestamp } from './timestamp'

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
})
