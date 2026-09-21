import { SIDEBAR_TOOL_IDS, type SidebarToolId } from '../../shared/types'

const knownTools = new Set<string>(SIDEBAR_TOOL_IDS)

export function normalizeSidebarToolOrder(value?: readonly string[]): SidebarToolId[] {
  const result: SidebarToolId[] = []
  for (const id of value ?? []) {
    if (knownTools.has(id) && !result.includes(id as SidebarToolId)) result.push(id as SidebarToolId)
  }
  for (const id of SIDEBAR_TOOL_IDS) {
    if (!result.includes(id)) result.push(id)
  }
  return result
}

export function moveSidebarTool(order: readonly SidebarToolId[], id: SidebarToolId, direction: -1 | 1): SidebarToolId[] {
  const normalized = normalizeSidebarToolOrder(order)
  const index = normalized.indexOf(id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= normalized.length) return normalized
  const next = [...normalized]
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  return next
}
