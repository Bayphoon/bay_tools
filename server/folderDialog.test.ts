import { describe, expect, it } from 'vitest'
import { parseFolderDialogOutput } from './folderDialog.js'

describe('folder dialog output', () => {
  it('parses a selected path and cancellation', () => {
    expect(parseFolderDialogOutput('\uFEFFD:\\Docs\r\n')).toBe('D:\\Docs')
    expect(parseFolderDialogOutput('  ')).toBeNull()
  })
})
