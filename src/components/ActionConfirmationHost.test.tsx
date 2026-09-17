// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { confirmAction } from '../lib/confirmation'
import { ActionConfirmationHost } from './ActionConfirmationHost'

describe('ActionConfirmationHost', () => {
  afterEach(() => {
    cleanup()
    document.body.replaceChildren()
  })

  it('shows the confirmation next to the active action and resolves true', async () => {
    const anchor = document.createElement('button')
    anchor.textContent = '删除'
    anchor.getBoundingClientRect = () => ({
      left: 80,
      top: 40,
      right: 120,
      bottom: 68,
      width: 40,
      height: 28,
      x: 80,
      y: 40,
      toJSON: () => ({}),
    })
    document.body.append(anchor)
    anchor.focus()
    render(<ActionConfirmationHost />)

    let result!: Promise<boolean>
    act(() => { result = confirmAction('确认删除这个项目？', { confirmLabel: '删除' }) })
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.textContent).toContain('确认删除这个项目？')
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await expect(result).resolves.toBe(true)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('cancels with Escape', async () => {
    render(<ActionConfirmationHost />)
    let result!: Promise<boolean>
    act(() => { result = confirmAction('确认操作？') })
    await screen.findByRole('alertdialog')
    fireEvent.keyDown(window, { key: 'Escape' })
    await expect(result).resolves.toBe(false)
  })
})
