// CLAUDE.md §14: structured lines carrying matchId, tick and playerId wherever they are known.
export type LogFields = {
  matchId?: string
  tick?: number
  playerId?: string
  [key: string]: unknown
}

export type Level = 'info' | 'warn' | 'error'

export type Logger = (level: Level, message: string, fields?: LogFields) => void

export const consoleLogger: Logger = (level, message, fields = {}) => {
  const line = JSON.stringify({ level, message, ...fields })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const silentLogger: Logger = () => {}
