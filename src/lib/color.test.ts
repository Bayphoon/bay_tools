import { describe, expect, it } from 'vitest'
import { convertColor } from './color'

describe('color conversion', () => {
  it('converts between supported formats', () => {
    expect(convertColor('#3366cc', 'hex')).toEqual({ hex: '#3366CC', rgb255: 'rgb(51, 102, 204)', rgb1: 'rgb(0.200, 0.400, 0.800)' })
    expect(convertColor('0.2, 0.4, 0.8', 'rgb1').hex).toBe('#3366CC')
    expect(convertColor('rgb(51, 102, 204)', 'rgb255').hex).toBe('#3366CC')
  })

  it('rejects out-of-range channels and alpha formats', () => {
    expect(() => convertColor('256, 0, 0', 'rgb255')).toThrow('0～255')
    expect(() => convertColor('#3366CCFF', 'hex')).toThrow('六位')
  })
})
