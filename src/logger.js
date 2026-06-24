import { config } from './config.js'

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const currentLevel = LEVELS[config.log.level] ?? LEVELS.info

function log(level, module, message, data = null) {
  if (LEVELS[level] < currentLevel) return

  const ts = new Date().toISOString()
  const prefix = `[${ts}] [${level.toUpperCase()}] [${module}]`
  const line = data
    ? `${prefix} ${message} ${JSON.stringify(data)}`
    : `${prefix} ${message}`

  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (mod, msg, data) => log('debug', mod, msg, data),
  info:  (mod, msg, data) => log('info',  mod, msg, data),
  warn:  (mod, msg, data) => log('warn',  mod, msg, data),
  error: (mod, msg, data) => log('error', mod, msg, data),
}
