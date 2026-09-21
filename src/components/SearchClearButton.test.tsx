// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { clearSearchOnEscape, SearchClearButton } from './SearchClearButton'

function SearchHarness() {
  const [value, setValue] = useState('hero config')
  const clear = () => setValue('')
  return <label><input aria-label="测试搜索" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => clearSearchOnEscape(event, value, clear)} /><SearchClearButton value={value} onClear={clear} /></label>
}

afterEach(cleanup)

describe('SearchClearButton', () => {
  it('clears a focused search input with Escape', () => {
    render(<SearchHarness />)
    const input = screen.getByLabelText('测试搜索') as HTMLInputElement
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
    expect(screen.queryByRole('button', { name: '清空搜索' })).toBeNull()
  })

  it('clears the search input from the clear button', () => {
    render(<SearchHarness />)
    fireEvent.click(screen.getByRole('button', { name: '清空搜索' }))
    expect((screen.getByLabelText('测试搜索') as HTMLInputElement).value).toBe('')
  })
})
