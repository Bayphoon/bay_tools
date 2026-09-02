export type TimestampUnit = 'auto' | 'seconds' | 'milliseconds'

export interface TimestampResult {
  date: Date
  detectedUnit: Exclude<TimestampUnit, 'auto'>
  seconds: number
  milliseconds: number
  local: string
  utc: string
}

const pad = (value: number) => String(value).padStart(2, '0')

export function formatLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function formatUtc(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`
}

export function parseTimestamp(input: string, unit: TimestampUnit = 'auto'): TimestampResult {
  const trimmed = input.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) throw new Error('请输入有效的数字时间戳')
  const numeric = Number(trimmed)
  if (!Number.isFinite(numeric)) throw new Error('时间戳超出支持范围')
  const detectedUnit = unit === 'auto' ? (Math.abs(numeric) < 100_000_000_000 ? 'seconds' : 'milliseconds') : unit
  const milliseconds = detectedUnit === 'seconds' ? Math.round(numeric * 1000) : Math.round(numeric)
  const date = new Date(milliseconds)
  if (Number.isNaN(date.getTime())) throw new Error('时间戳无法转换为日期')
  return {
    date,
    detectedUnit,
    seconds: Math.floor(milliseconds / 1000),
    milliseconds,
    local: formatLocal(date),
    utc: formatUtc(date),
  }
}

export function dateInputToTimestamp(input: string): TimestampResult {
  const date = new Date(input)
  if (!input || Number.isNaN(date.getTime())) throw new Error('请选择有效的本地日期时间')
  return parseTimestamp(String(date.getTime()), 'milliseconds')
}
