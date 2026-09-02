import { useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'
import type { AppSettings } from '../../shared/types'
import { formatLocal } from '../lib/timestamp'
import { getWorkStatus } from '../lib/workTime'

export function ClockPanel({ settings }: { settings: AppSettings }) {
  const [date, setDate] = useState(new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setDate(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const status = getWorkStatus(date, settings.workSchedule)
  return <div className="clock-panel">
    <Clock3 size={18} />
    <div className="clock-current"><strong>{formatLocal(date)}</strong></div>
    <div className="clock-divider" />
    <div><span>{status.label}</span><strong>{status.value}</strong>{status.secondary && <small>{status.secondary}</small>}</div>
  </div>
}
