import { X } from 'lucide-react'
import type { KeyboardEvent } from 'react'

export function clearSearchOnEscape(event: KeyboardEvent<HTMLInputElement>, value: string, onClear: () => void): void {
  if (event.key !== 'Escape' || !value) return
  event.preventDefault()
  event.stopPropagation()
  onClear()
}

export function SearchClearButton({ value, onClear, label = '清空搜索', className = '' }: {
  value: string
  onClear: () => void
  label?: string
  className?: string
}) {
  if (!value) return null
  return <button type="button" className={`search-clear-button ${className}`.trim()} aria-label={label} onClick={onClear}><X size={13} /></button>
}
