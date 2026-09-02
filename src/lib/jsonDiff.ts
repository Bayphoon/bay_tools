export type DiffKind = 'added' | 'removed' | 'changed'

export interface JsonDifference {
  path: string
  kind: DiffKind
  left?: unknown
  right?: unknown
}

function escapePointer(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function diffJson(left: unknown, right: unknown, path = ''): JsonDifference[] {
  if (Object.is(left, right)) return []
  if (Array.isArray(left) && Array.isArray(right)) {
    const result: JsonDifference[] = []
    const length = Math.max(left.length, right.length)
    for (let index = 0; index < length; index += 1) {
      const childPath = `${path}/${index}`
      if (index >= left.length) result.push({ path: childPath, kind: 'added', right: right[index] })
      else if (index >= right.length) result.push({ path: childPath, kind: 'removed', left: left[index] })
      else result.push(...diffJson(left[index], right[index], childPath))
    }
    return result
  }
  if (isObject(left) && isObject(right)) {
    const result: JsonDifference[] = []
    for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
      const childPath = `${path}/${escapePointer(key)}`
      if (!(key in left)) result.push({ path: childPath, kind: 'added', right: right[key] })
      else if (!(key in right)) result.push({ path: childPath, kind: 'removed', left: left[key] })
      else result.push(...diffJson(left[key], right[key], childPath))
    }
    return result
  }
  return [{ path: path || '/', kind: 'changed', left, right }]
}
