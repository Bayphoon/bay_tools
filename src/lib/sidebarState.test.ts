import { describe, expect, it } from 'vitest'
import { setSidebarGroupCollapsed, sidebarGroupCollapsed } from './sidebarState'

describe('sidebarState', () => {
  it('preserves unrelated entries while toggling a nested group', () => {
    const initial = ['json', 'markdown-source:source-1']
    const collapsed = setSidebarGroupCollapsed(initial, 'json-folder:folder-1', true)
    expect(collapsed).toEqual(['json', 'markdown-source:source-1', 'json-folder:folder-1'])
    expect(sidebarGroupCollapsed(collapsed, 'json-folder:folder-1')).toBe(true)
    expect(setSidebarGroupCollapsed(collapsed, 'json-folder:folder-1', false)).toEqual(initial)
  })

  it('keeps updates idempotent', () => {
    const groups = ['managed-documents']
    expect(setSidebarGroupCollapsed(groups, 'managed-documents', true)).toBe(groups)
    expect(setSidebarGroupCollapsed(groups, 'missing', false)).toBe(groups)
  })
})
