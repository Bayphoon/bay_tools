import { describe, expect, it } from 'vitest'
import { parseSingleByteRange } from './fileRange.js'

describe('parseSingleByteRange', () => {
  it('supports explicit, open-ended and suffix ranges', () => {
    expect(parseSingleByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 })
    expect(parseSingleByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 })
    expect(parseSingleByteRange('bytes=-8', 100)).toEqual({ start: 92, end: 99 })
    expect(parseSingleByteRange(undefined, 100)).toBeUndefined()
  })

  it('rejects invalid, multiple, and unsatisfiable ranges', () => {
    expect(() => parseSingleByteRange('bytes=100-110', 100)).toThrow()
    expect(() => parseSingleByteRange('bytes=0-1,4-5', 100)).toThrow()
    expect(() => parseSingleByteRange('items=0-1', 100)).toThrow()
    expect(() => parseSingleByteRange('bytes=0-0', 0)).toThrow()
  })
})
