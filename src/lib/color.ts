import type { ColorValue } from '../../shared/types'

export type ColorInputKind = 'rgb255' | 'rgb1' | 'hex'
export interface RgbColor { r: number; g: number; b: number }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function numbers(input: string): number[] {
  return input.replace(/^rgba?\(/i, '').replace(/\)$/, '').split(/[\s,]+/).filter(Boolean).map(Number)
}

export function parseColor(input: string, kind: ColorInputKind): RgbColor {
  const value = input.trim()
  if (kind === 'hex') {
    const match = /^#?([0-9a-f]{6})$/i.exec(value)
    if (!match) throw new Error('请输入六位十六进制颜色，例如 #3366CC')
    const hex = match[1]
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }
  }
  const values = numbers(value)
  if (values.length !== 3 || values.some((entry) => !Number.isFinite(entry))) throw new Error('请输入三个有效的 RGB 分量')
  const max = kind === 'rgb255' ? 255 : 1
  if (values.some((entry) => entry < 0 || entry > max)) throw new Error(kind === 'rgb255' ? 'RGB 分量范围是 0～255' : 'RGB 分量范围是 0～1')
  const scale = kind === 'rgb255' ? 1 : 255
  return { r: Math.round(values[0] * scale), g: Math.round(values[1] * scale), b: Math.round(values[2] * scale) }
}

export function rgbToColorValue(color: RgbColor): ColorValue {
  const r = Math.round(clamp(color.r, 0, 255))
  const g = Math.round(clamp(color.g, 0, 255))
  const b = Math.round(clamp(color.b, 0, 255))
  const hex = `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  return {
    hex,
    rgb255: `rgb(${r}, ${g}, ${b})`,
    rgb1: `rgb(${(r / 255).toFixed(3)}, ${(g / 255).toFixed(3)}, ${(b / 255).toFixed(3)})`,
  }
}

export function convertColor(input: string, kind: ColorInputKind): ColorValue {
  return rgbToColorValue(parseColor(input, kind))
}
