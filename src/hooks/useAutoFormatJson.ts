import { useEffect, useRef } from 'react'
import { tryFormatJson } from '../lib/jsonFormat'

export const JSON_AUTO_FORMAT_DELAY = 450

export function useAutoFormatJson(text: string, enabled: boolean, onFormat: (value: string) => void) {
  const onFormatRef = useRef(onFormat)

  useEffect(() => {
    onFormatRef.current = onFormat
  }, [onFormat])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setTimeout(() => {
      const formatted = tryFormatJson(text)
      if (formatted !== undefined && formatted !== text) onFormatRef.current(formatted)
    }, JSON_AUTO_FORMAT_DELAY)
    return () => window.clearTimeout(timer)
  }, [enabled, text])
}
