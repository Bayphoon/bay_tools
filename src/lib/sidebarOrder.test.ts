import { describe, expect, it } from 'vitest'
import { SIDEBAR_TOOL_IDS } from '../../shared/types'
import { moveSidebarTool, normalizeSidebarToolOrder } from './sidebarOrder'

describe('sidebar tool order', () => {
  it('keeps valid custom order and appends newly introduced tools', () => {
    const order = normalizeSidebarToolOrder(['server-status', 'json', 'json', 'removed-tool'])
    expect(order.slice(0, 2)).toEqual(['server-status', 'json'])
    expect(order).toHaveLength(SIDEBAR_TOOL_IDS.length)
    expect(new Set(order).size).toBe(SIDEBAR_TOOL_IDS.length)
    expect(order).toContain('bookmarks')
  })

  it('moves one tool without losing the rest', () => {
    const initial = normalizeSidebarToolOrder()
    const moved = moveSidebarTool(initial, 'json', -1)
    expect(moved.slice(0, 2)).toEqual(['json', 'bookmarks'])
    expect(new Set(moved)).toEqual(new Set(initial))
    expect(moveSidebarTool(moved, 'json', -1)).toEqual(moved)
  })
})
