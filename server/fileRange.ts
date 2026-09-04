import { AppError } from './errors.js'

export interface ByteRange {
  start: number
  end: number
}

export function parseSingleByteRange(value: string | undefined, size: number): ByteRange | undefined {
  if (!value) return undefined
  if (!Number.isSafeInteger(size) || size <= 0 || value.includes(',')) throw new AppError(416, 'INVALID_RANGE', '文件读取范围无效')
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || (!match[1] && !match[2])) throw new AppError(416, 'INVALID_RANGE', '文件读取范围无效')
  let start: number
  let end: number
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw new AppError(416, 'INVALID_RANGE', '文件读取范围无效')
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) throw new AppError(416, 'INVALID_RANGE', '文件读取范围无效')
    end = Math.min(end, size - 1)
  }
  if (start < 0 || start >= size || end < start) throw new AppError(416, 'INVALID_RANGE', '文件读取范围无效')
  return { start, end }
}
