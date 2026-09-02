import { useMemo } from 'react'
import type { JsonDifference } from '../lib/jsonDiff'

function matches(value: unknown, key: string, search: string): boolean {
  if (!search) return true
  const text = `${key} ${typeof value === 'string' ? value : JSON.stringify(value)}`.toLowerCase()
  if (text.includes(search)) return true
  if (Array.isArray(value)) return value.some((entry, index) => matches(entry, String(index), search))
  if (value && typeof value === 'object') return Object.entries(value).some(([childKey, child]) => matches(child, childKey, search))
  return false
}

function Node({ name, value, path, search, diffMap }: { name: string; value: unknown; path: string; search: string; diffMap: Map<string, JsonDifference> }) {
  if (!matches(value, name, search)) return null
  const difference = diffMap.get(path)
  const className = difference ? `tree-row diff-${difference.kind}` : 'tree-row'
  if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
    const entries = Object.entries(value as object)
    return <details open={Boolean(search) || path.split('/').length < 3} className="json-tree-node">
      <summary className={className}><span className="tree-key">{name}</span><span className="tree-meta">{Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`}</span></summary>
      <div className="tree-children">{entries.map(([key, child]) => <Node key={key} name={key} value={child} path={`${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`} search={search} diffMap={diffMap} />)}</div>
    </details>
  }
  return <div className={className}><span className="tree-key">{name}</span><span className={`tree-value type-${value === null ? 'null' : typeof value}`}>{JSON.stringify(value)}</span></div>
}

export function JsonTree({ text, search = '', differences = [] }: { text: string; search?: string; differences?: JsonDifference[] }) {
  const parsed = useMemo(() => {
    try { return { value: JSON.parse(text) as unknown } } catch (error) { return { error: error instanceof Error ? error.message : 'JSON 无效' } }
  }, [text])
  const map = useMemo(() => new Map(differences.map((item) => [item.path, item])), [differences])
  if ('error' in parsed) return <div className="tree-error">{parsed.error}</div>
  return <div className="json-tree"><Node name="$" value={parsed.value} path="" search={search.trim().toLowerCase()} diffMap={map} /></div>
}
