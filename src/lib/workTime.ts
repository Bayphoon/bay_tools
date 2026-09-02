import type { AppSettings } from '../../shared/types'

export interface WorkStatus { label: string; value: string; secondary?: string }

const secondsAt = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 3600 + minutes * 60
}

const duration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const rest = safe % 60
  return `${hours ? `${hours}小时 ` : ''}${String(minutes).padStart(2, '0')}分 ${String(rest).padStart(2, '0')}秒`
}

export function getWorkStatus(date: Date, schedule: AppSettings['workSchedule']): WorkStatus {
  if (!schedule.workDays.includes(date.getDay())) return { label: '今天', value: '休息日' }
  const current = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()
  const start = secondsAt(schedule.start)
  const lunchStart = secondsAt(schedule.lunchStart)
  const lunchEnd = secondsAt(schedule.lunchEnd)
  const dinnerStart = secondsAt(schedule.dinnerStart)
  const end = secondsAt(schedule.end)
  if (current < start) return { label: '距离上班', value: duration(start - current) }
  if (current < lunchStart) return { label: '距离午饭', value: duration(lunchStart - current) }
  if (current < lunchEnd) return { label: '午休剩余', value: duration(lunchEnd - current) }
  if (current < dinnerStart) return { label: '距离晚饭', value: duration(dinnerStart - current) }
  if (current < end) return { label: '晚饭 / 休息剩余', value: duration(end - current), secondary: `距离下班 ${duration(end - current)}` }
  return { label: '已加班', value: duration(current - end) }
}
