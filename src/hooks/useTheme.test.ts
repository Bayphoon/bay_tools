import { describe, expect, it } from 'vitest'
import type { AppSettings } from '../../shared/types'
import { themeBlend } from './useTheme'

const settings = { theme: { mode: 'solar', sunrise: '06:00', sunset: '19:00', transitionMinutes: 30 } } as AppSettings
const at = (hours: number, minutes: number) => new Date(2026, 7, 31, hours, minutes)

describe('solar theme', () => {
  it('transitions at sunrise and sunset boundaries', () => {
    expect(themeBlend(settings, at(5, 59))).toBe(1)
    expect(themeBlend(settings, at(6, 0))).toBe(1)
    expect(themeBlend(settings, at(6, 15))).toBeCloseTo(.5)
    expect(themeBlend(settings, at(6, 30))).toBe(0)
    expect(themeBlend(settings, at(19, 0))).toBe(0)
    expect(themeBlend(settings, at(19, 15))).toBeCloseTo(.5)
    expect(themeBlend(settings, at(19, 30))).toBe(1)
  })
})
