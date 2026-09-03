import { describe, expect, it } from 'vitest'
import { parseShortcutOutput } from './shortcut.js'

describe('shortcut helper', () => {
  it('parses PowerShell shortcut results including a BOM', () => {
    expect(parseShortcutOutput('\uFEFF{"path":"C:\\\\Users\\\\Tester\\\\Desktop\\\\BayTools.lnk","replaced":true}', 'desktop')).toEqual({
      location: 'desktop',
      path: 'C:\\Users\\Tester\\Desktop\\BayTools.lnk',
      replaced: true,
    })
  })

  it('rejects malformed helper output', () => {
    expect(() => parseShortcutOutput('not-json', 'start-menu')).toThrow('快捷方式创建结果无法识别')
  })
})
