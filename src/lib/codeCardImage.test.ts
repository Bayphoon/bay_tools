import { describe, expect, it } from 'vitest'
import { thumbnailDimensions } from './codeCardImage'

describe('thumbnailDimensions', () => {
  it('keeps small images unchanged', () => expect(thumbnailDimensions(800, 600)).toEqual({ width: 800, height: 600 }))
  it('scales wide images proportionally', () => expect(thumbnailDimensions(3200, 1800)).toEqual({ width: 1600, height: 900 }))
  it('scales tall images proportionally', () => expect(thumbnailDimensions(900, 2700)).toEqual({ width: 533, height: 1600 }))
  it('rejects invalid dimensions', () => expect(() => thumbnailDimensions(0, 100)).toThrow('图片尺寸无效'))
})
