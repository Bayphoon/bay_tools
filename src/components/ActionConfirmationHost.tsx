import { AlertTriangle } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { BAYTOOLS_CONFIRM_EVENT, type ConfirmationRequest } from '../lib/confirmation'

export function ActionConfirmationHost() {
  const [request, setRequest] = useState<ConfirmationRequest>()
  const [position, setPosition] = useState({ left: 12, top: 12 })
  const panel = useRef<HTMLDivElement>(null)
  const current = useRef<ConfirmationRequest | undefined>(undefined)

  const close = (result: boolean) => {
    const active = current.current
    current.current = undefined
    setRequest(undefined)
    active?.resolve(result)
  }

  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<ConfirmationRequest>).detail
      current.current?.resolve(false)
      current.current = next
      setRequest(next)
    }
    window.addEventListener(BAYTOOLS_CONFIRM_EVENT, open)
    return () => {
      window.removeEventListener(BAYTOOLS_CONFIRM_EVENT, open)
      current.current?.resolve(false)
      current.current = undefined
    }
  }, [])

  useLayoutEffect(() => {
    if (!request || !panel.current) return
    const bounds = panel.current.getBoundingClientRect()
    const margin = 10
    const left = Math.min(Math.max(margin, request.anchor.left), Math.max(margin, window.innerWidth - bounds.width - margin))
    const below = request.anchor.bottom + 7
    const top = below + bounds.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, request.anchor.top - bounds.height - 7)
    setPosition({ left, top })
  }, [request])

  useEffect(() => {
    if (!request) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(false) }
    const onPointerDown = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) close(false) }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [request])

  if (!request) return null
  return createPortal(<div ref={panel} className="action-confirmation" role="alertdialog" aria-modal="false" style={{ '--confirm-left': `${position.left}px`, '--confirm-top': `${position.top}px` } as CSSProperties}>
    <div className="action-confirmation-message"><AlertTriangle size={17} /><span>{request.message}</span></div>
    <div className="action-confirmation-actions"><button onClick={() => close(false)}>{request.cancelLabel}</button><button className={request.danger ? 'danger' : 'primary'} autoFocus onClick={() => close(true)}>{request.confirmLabel}</button></div>
  </div>, document.body)
}
