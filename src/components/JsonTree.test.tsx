// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { JsonTree } from './JsonTree'

describe('JsonTree', () => {
  it('renders nested JSON and filters by search text', () => {
    const { rerender } = render(<JsonTree text='{"project":"BayTools","hidden":"other"}' />)
    expect(screen.getByText('project')).toBeTruthy()
    expect(screen.getByText('hidden')).toBeTruthy()
    rerender(<JsonTree text='{"project":"BayTools","hidden":"other"}' search="BayTools" />)
    expect(screen.getByText('project')).toBeTruthy()
    expect(screen.queryByText('hidden')).toBeNull()
  })

  it('shows invalid JSON errors', () => {
    render(<JsonTree text="{" />)
    expect(screen.getByText(/JSON|Expected/)).toBeTruthy()
  })
})
