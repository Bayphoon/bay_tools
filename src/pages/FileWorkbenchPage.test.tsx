// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImportClipboardDialog } from './FileWorkbenchPage'

describe('file workbench import dialog', () => {
  afterEach(() => vi.restoreAllMocks())

  it('revokes the image preview URL when the dialog closes', async () => {
    const createObjectURL = vi.fn(() => 'blob:clipboard-preview')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })

    const blob = new Blob(['image'], { type: 'image/png' })
    const view = render(<ImportClipboardDialog
      candidates={[{ kind: 'image', source: 'clipboard', blob, mimeType: 'image/png' }]}
      uploading={false}
      onClose={() => undefined}
      onImport={async () => true}
    />)

    await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(blob))
    view.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:clipboard-preview')
  })
})
