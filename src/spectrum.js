import { config } from './config.js'
import { logger } from './logger.js'
import { logSpectrumQuery } from './supabase.js'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// Current channel state
let currentChannel = null
let currentFrequencyMhz = null
let lastQueryTime = null

// ── FCC geolocation DB query ──────────────────────────────────────────────────

export async function queryAvailableChannels() {
  const { lat, lng } = config.location
  const url = `${config.fcc.dbUrl}/tvws/channels?lat=${lat}&lng=${lng}&deviceType=fixed&heightAboveTerrain=10`

  logger.info('spectrum', `Querying FCC geolocation DB for ${lat}, ${lng}`)

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      throw new Error(`FCC DB returned ${response.status}`)
    }

    const data = await response.json()
    const channels = data.availableChannels ?? []

    // Filter for channels with sufficient power (≥4W EIRP = 6 dBW)
    const viable = channels.filter(ch => ch.maxPowerDbw >= 6)

    logger.info('spectrum', `${viable.length} viable channels found`, {
      total: channels.length,
      viable: viable.length,
    })

    lastQueryTime = Date.now()
    await logSpectrumQuery(viable)
    return viable

  } catch (err) {
    logger.error('spectrum', 'FCC DB query failed', { error: err.message })

    // Return last known channel as fallback
    if (currentChannel) {
      logger.warn('spectrum', `Using last known channel ${currentChannel} as fallback`)
      return [{ channel: currentChannel, frequencyMhz: currentFrequencyMhz, maxPowerDbw: 6 }]
    }

    return []
  }
}

// ── Channel selection ─────────────────────────────────────────────────────────

export function selectOptimalChannel(channels) {
  if (!channels.length) return null

  // Sort by max power descending, then channel number ascending (lower = better propagation)
  const sorted = [...channels].sort((a, b) => {
    if (b.maxPowerDbw !== a.maxPowerDbw) return b.maxPowerDbw - a.maxPowerDbw
    return a.channel - b.channel
  })

  return sorted[0]
}

// ── Radio configuration ───────────────────────────────────────────────────────

export async function configureRadio(channel) {
  if (!channel) {
    logger.error('spectrum', 'Cannot configure radio — no channel available')
    return false
  }

  const iface = config.network.tvwsInterface
  logger.info('spectrum', `Configuring ${iface} on channel ${channel.channel} (${channel.frequencyMhz} MHz)`)

  try {
    // Bring interface down
    await execAsync(`sudo ip link set ${iface} down`)

    // Set to managed mode for TVWS operation
    await execAsync(`sudo iw ${iface} set type managed`)

    // Bring interface back up
    await execAsync(`sudo ip link set ${iface} up`)

    // Set frequency (convert MHz to kHz for iw)
    const freqKhz = channel.frequencyMhz * 1000
    await execAsync(`sudo iw ${iface} set freq ${freqKhz}`)

    currentChannel = channel.channel
    currentFrequencyMhz = channel.frequencyMhz

    logger.info('spectrum', `Radio configured: channel ${currentChannel}, ${currentFrequencyMhz} MHz`)
    return true

  } catch (err) {
    logger.error('spectrum', 'Radio configuration failed', { error: err.message })
    return false
  }
}

// ── Signal strength ───────────────────────────────────────────────────────────

export async function getSignalStrength() {
  const iface = config.network.tvwsInterface
  try {
    const { stdout } = await execAsync(`iw ${iface} station dump`)
    const match = stdout.match(/signal:\s+([-\d]+)\s+dBm/)
    return match ? parseInt(match[1]) : null
  } catch {
    return null
  }
}

// ── Getters ───────────────────────────────────────────────────────────────────

export function getCurrentChannel() { return currentChannel }
export function getCurrentFrequency() { return currentFrequencyMhz }
export function getLastQueryTime() { return lastQueryTime }

// ── Scheduled re-query ────────────────────────────────────────────────────────

export async function refreshSpectrum() {
  const channels = await queryAvailableChannels()
  const optimal = selectOptimalChannel(channels)

  if (!optimal) {
    logger.warn('spectrum', 'No viable channels found on re-query')
    return false
  }

  // Only reconfigure if channel has changed
  if (optimal.channel !== currentChannel) {
    logger.info('spectrum', `Channel change: ${currentChannel} → ${optimal.channel}`)
    return await configureRadio(optimal)
  }

  logger.debug('spectrum', `Channel ${currentChannel} still optimal — no change`)
  return true
}
