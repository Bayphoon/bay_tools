import { describe, expect, it } from 'vitest'
import { tryFormatJson } from './jsonFormat'

describe('tryFormatJson', () => {
  it('formats valid JSON with two-space indentation', () => {
    expect(tryFormatJson('{"name":"BayTools","enabled":true}')).toBe(' {\n  "name": "BayTools",\n  "enabled": true\n}'.trimStart())
  })

  it('leaves invalid JSON unavailable for auto formatting', () => {
    expect(tryFormatJson('{"name":')).toBeUndefined()
  })

  it('supports valid JSON primitives', () => {
    expect(tryFormatJson('123')).toBe('123')
  })
})
