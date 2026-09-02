import { describe, expect, it } from 'vitest'
import type { AppSettings } from '../../shared/types'
import { getWorkStatus } from './workTime'

const schedule: AppSettings['workSchedule'] = { workDays: [1, 2, 3, 4, 5], start: '10:00', lunchStart: '12:30', lunchEnd: '14:00', dinnerStart: '18:30', end: '19:30' }
const at = (day: number, hours: number, minutes: number, seconds = 0) => new Date(2026, 7, day, hours, minutes, seconds)

describe('work clock', () => {
  it('covers every schedule segment', () => {
    expect(getWorkStatus(at(31, 9, 0), schedule).label).toBe('距离上班')
    expect(getWorkStatus(at(31, 10, 0), schedule).label).toBe('距离午饭')
    expect(getWorkStatus(at(31, 12, 30), schedule).label).toBe('午休剩余')
    expect(getWorkStatus(at(31, 14, 0), schedule).label).toBe('距离晚饭')
    expect(getWorkStatus(at(31, 18, 30), schedule).label).toBe('晚饭 / 休息剩余')
    expect(getWorkStatus(at(31, 19, 30), schedule).label).toBe('已加班')
  })

  it('marks weekends as rest days', () => {
    expect(getWorkStatus(at(30, 12, 0), schedule).value).toBe('休息日')
  })
})
