import { describe, expect, it } from 'vitest'
import type { ServerStatusRecord } from '../../shared/types'
import { filterServersBySeason, formatCardSeasons, formatSeasonDays, getSeasonOptions } from './serverStatus'

const servers: ServerStatusRecord[] = [
  { server_id: 'a', running_status: '已启动', season_days: { S3: 4 }, config_branch: '', code_branch: '' },
  { server_id: 'b', running_status: '未启动', season_days: {}, config_branch: '', code_branch: '' },
  { server_id: 'c', running_status: '', season_days: { S10: 1, S3: 8 }, config_branch: '', code_branch: '' },
  { server_id: 'd', running_status: '', season_days: { S0: 2 }, config_branch: '', code_branch: '' },
]

describe('server status season helpers', () => {
  it('builds sorted dynamic options', () => {
    expect(getSeasonOptions(servers)).toEqual(['S0', 'S3', 'S10'])
  })

  it('treats empty season data as season zero when filtering', () => {
    expect(filterServersBySeason(servers, 'all')).toHaveLength(4)
    expect(filterServersBySeason(servers, 'S0').map((item) => item.server_id)).toEqual(['b', 'd'])
    expect(filterServersBySeason(servers, 'S3').map((item) => item.server_id)).toEqual(['a', 'c'])
  })

  it('formats one, empty, and multiple seasons', () => {
    expect(formatSeasonDays({})).toBe('第0赛季')
    expect(formatSeasonDays({ S0: 2 })).toBe('第0赛季 · 第2天')
    expect(formatSeasonDays({ S3: 4 })).toBe('第3赛季 · 第4天')
    expect(formatSeasonDays({ S10: 1, S3: 8 })).toBe('第3赛季 · 第8天；第10赛季 · 第1天')
  })

  it('formats compact card seasons and hides season zero', () => {
    expect(formatCardSeasons({})).toBe('')
    expect(formatCardSeasons({ S0: 2 })).toBe('')
    expect(formatCardSeasons({ S3: 4 })).toBe('S3')
    expect(formatCardSeasons({ S10: 1, S3: 8, S0: 2 })).toBe('S3 / S10')
  })
})
