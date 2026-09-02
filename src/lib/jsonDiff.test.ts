import { describe, expect, it } from 'vitest'
import { diffJson } from './jsonDiff'

describe('structured JSON diff', () => {
  it('ignores object key order', () => {
    expect(diffJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([])
  })

  it('compares arrays by index and values by type', () => {
    expect(diffJson([1, 2], [1, 3, 4])).toEqual([
      { path: '/1', kind: 'changed', left: 2, right: 3 },
      { path: '/2', kind: 'added', right: 4 },
    ])
    expect(diffJson(1, '1')[0]?.kind).toBe('changed')
  })

  it('uses escaped JSON pointer paths', () => {
    expect(diffJson({ 'a/b': 1 }, { 'a/b': 2 })[0]?.path).toBe('/a~1b')
  })
})
