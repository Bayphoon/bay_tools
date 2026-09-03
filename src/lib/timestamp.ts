export type TimestampUnit = 'auto' | 'seconds' | 'milliseconds'
export type DateInputTimeZone = 'beijing' | 'utc'

export interface TimestampResult {
  date: Date
  detectedUnit: Exclude<TimestampUnit, 'auto'>
  seconds: number
  milliseconds: number
  local: string
  utc: string
}

const pad = (value: number) => String(value).padStart(2, '0')
const DATE_INPUT_PATTERN = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[ T](\d{1,2})(?::(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,9}))?)?)?)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/i

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

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function parseOffset(value: string | undefined, defaultTimeZone: DateInputTimeZone): number {
  if (!value) return defaultTimeZone === 'beijing' ? 8 * 60 : 0
  if (value.toUpperCase() === 'Z') return 0

  const sign = value.startsWith('-') ? -1 : 1
  const digits = value.slice(1).replace(':', '')
  const hours = Number(digits.slice(0, 2))
  const minutes = Number(digits.slice(2, 4))
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
    throw new Error('时区偏移无效，请使用 Z、+08:00 或 +0800 等格式')
  }
  return sign * (hours * 60 + minutes)
}

export function dateInputToTimestamp(input: string, defaultTimeZone: DateInputTimeZone = 'beijing'): TimestampResult {
  const trimmed = input.trim()
  if (!trimmed) throw new Error('请输入日期时间')

  const match = DATE_INPUT_PATTERN.exec(trimmed)
  if (!match) {
    throw new Error('不支持的日期格式，请输入 YYYY-MM-DD、YYYY/MM/DD 或带时间的常用格式')
  }

  const [, yearText, , monthText, dayText, hourText = '0', minuteText = '0', secondText = '0', fraction = '', offsetText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3) || '0')

  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)
    || hour > 23 || minute > 59 || second > 59) {
    throw new Error('日期不存在或时间字段超出有效范围')
  }

  const offsetMinutes = parseOffset(offsetText, defaultTimeZone)
  const utcDate = new Date(0)
  utcDate.setUTCFullYear(year, month - 1, day)
  utcDate.setUTCHours(hour, minute, second, milliseconds)
  const utcMilliseconds = utcDate.getTime() - offsetMinutes * 60_000
  if (!Number.isFinite(utcMilliseconds)) throw new Error('日期超出支持范围')
  return parseTimestamp(String(utcMilliseconds), 'milliseconds')
}
