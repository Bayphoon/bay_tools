import { useEffect } from 'react'
import type { AppSettings } from '../../shared/types'

function hexChannels(hex: string): [number, number, number] {
  const value = hex.replace('#', '')
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)]
}

function blend(left: string, right: string, amount: number): string {
  const a = hexChannels(left)
  const b = hexChannels(right)
  return `rgb(${a.map((value, index) => Math.round(value + (b[index] - value) * amount)).join(' ')})`
}

export function themeBlend(settings: AppSettings, date = new Date()): number {
  const mode = settings.theme.mode
  if (mode === 'light') return 0
  if (mode === 'dark') return 1
  if (mode === 'manual') return settings.theme.manualBlend
  const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60
  const [sunriseHour, sunriseMinute] = settings.theme.sunrise.split(':').map(Number)
  const [sunsetHour, sunsetMinute] = settings.theme.sunset.split(':').map(Number)
  const sunrise = sunriseHour * 60 + sunriseMinute
  const sunset = sunsetHour * 60 + sunsetMinute
  const transition = settings.theme.transitionMinutes
  if (minutes >= sunrise && minutes < sunrise + transition) return 1 - (minutes - sunrise) / transition
  if (minutes >= sunrise + transition && minutes < sunset) return 0
  if (minutes >= sunset && minutes < sunset + transition) return (minutes - sunset) / transition
  return 1
}

export function applyTheme(settings: AppSettings): void {
  const amount = themeBlend(settings)
  const root = document.documentElement
  root.style.setProperty('--bg', blend('#F4F6FA', '#090D16', amount))
  root.style.setProperty('--surface', blend('#FFFFFF', '#111827', amount))
  root.style.setProperty('--surface-2', blend('#EEF2F7', '#172033', amount))
  root.style.setProperty('--surface-hover', blend('#E3E9F2', '#1F2A40', amount))
  root.style.setProperty('--border', blend('#CBD5E1', '#2C3850', amount))
  root.style.setProperty('--text', blend('#111827', '#E8EEF8', amount))
  root.style.setProperty('--muted', blend('#64748B', '#91A0B8', amount))
  root.style.setProperty('--accent', blend(settings.theme.lightAccent, settings.theme.darkAccent, amount))
  root.style.setProperty('--accent-contrast', amount > 0.55 ? '#08111F' : '#FFFFFF')
  root.style.setProperty('--json-key', blend('#1D4ED8', '#93C5FD', amount))
  root.style.setProperty('--json-string', blend('#047857', '#86EFAC', amount))
  root.style.setProperty('--json-number', blend('#B45309', '#FCD34D', amount))
  root.style.setProperty('--json-boolean', blend('#6D28D9', '#C4B5FD', amount))
  root.style.colorScheme = amount > 0.5 ? 'dark' : 'light'
}

export function useTheme(settings?: AppSettings): void {
  useEffect(() => {
    if (!settings) return
    applyTheme(settings)
    const timer = window.setInterval(() => applyTheme(settings), 30_000)
    return () => window.clearInterval(timer)
  }, [settings])
}
