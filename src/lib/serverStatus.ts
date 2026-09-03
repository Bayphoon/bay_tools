import type { ServerStatusRecord } from '../../shared/types'

export const ALL_SEASONS = 'all'
export const ZERO_SEASON = 'S0'

const seasonNumber = (key: string) => Number(key.slice(1))

export function getSeasonOptions(servers: ServerStatusRecord[]): string[] {
  return [...new Set(servers.flatMap((server) => {
    const seasons = Object.keys(server.season_days)
    return seasons.length ? seasons : [ZERO_SEASON]
  }))]
    .sort((left, right) => seasonNumber(left) - seasonNumber(right))
}

export function filterServersBySeason(servers: ServerStatusRecord[], season: string): ServerStatusRecord[] {
  if (season === ALL_SEASONS) return servers
  if (season === ZERO_SEASON) {
    return servers.filter((server) => Object.keys(server.season_days).length === 0 || Object.hasOwn(server.season_days, ZERO_SEASON))
  }
  return servers.filter((server) => Object.hasOwn(server.season_days, season))
}

export function formatSeasonDays(seasonDays: Record<string, number>): string {
  const entries = Object.entries(seasonDays).sort(([left], [right]) => seasonNumber(left) - seasonNumber(right))
  if (!entries.length) return '第0赛季'
  return entries.map(([season, day]) => `第${seasonNumber(season)}赛季 · 第${day}天`).join('；')
}

export function formatCardSeasons(seasonDays: Record<string, number>): string {
  return Object.keys(seasonDays)
    .filter((season) => season !== ZERO_SEASON)
    .sort((left, right) => seasonNumber(left) - seasonNumber(right))
    .join(' / ')
}
