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
  return <section className="dashboard-card home-summary-card clock-panel">
    <div className="home-card-heading"><h2>当前时间</h2><Clock3 size={16} /></div>
    <div className="clock-current"><strong>{formatLocal(date)}</strong></div>
    <div className="home-card-result clock-status">
      <div className="home-result-text"><span>{status.label}</span><strong>{status.value}</strong></div>
      {status.secondary && <small>{status.secondary}</small>}
    </div>
  </section>
}
