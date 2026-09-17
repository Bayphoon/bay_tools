export const BAYTOOLS_CONFIRM_EVENT = 'baytools:confirm'

export interface ConfirmationRequest {
  message: string
  confirmLabel: string
  cancelLabel: string
  danger: boolean
  anchor: DOMRect
  resolve(result: boolean): void
}

interface ConfirmationOptions {
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  anchor?: Element | null
}

export function confirmAction(message: string, options: ConfirmationOptions = {}): Promise<boolean> {
  const anchor = options.anchor ?? (document.activeElement instanceof Element ? document.activeElement : null)
  const anchorRect = anchor?.getBoundingClientRect() ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0)
  return new Promise((resolve) => window.dispatchEvent(new CustomEvent<ConfirmationRequest>(BAYTOOLS_CONFIRM_EVENT, {
    detail: {
      message,
      confirmLabel: options.confirmLabel ?? '确认',
      cancelLabel: options.cancelLabel ?? '取消',
      danger: options.danger ?? true,
      anchor: anchorRect,
      resolve,
    },
  })))
}
