export function setSidebarGroupCollapsed(groups: string[], key: string, collapsed: boolean): string[] {
  if (collapsed) return groups.includes(key) ? groups : [...groups, key]
  return groups.includes(key) ? groups.filter((value) => value !== key) : groups
}

export function sidebarGroupCollapsed(groups: string[], key: string): boolean {
  return groups.includes(key)
}
