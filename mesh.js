import { exec } from 'child_process'
import { promisify } from 'util'
import { config } from './config.js'
import { logger } from './logger.js'

const execAsync = promisify(exec)

// ── Mesh initialization ───────────────────────────────────────────────────────

export async function initMesh() {
  const iface = config.network.meshInterface
  const ip    = config.network.meshIp
  const ssid  = config.network.meshSsid

  logger.info('mesh', `Initializing mesh on ${iface}`)

  try {
    // Load batman-adv kernel module
    await execAsync('sudo modprobe batman-adv')
    logger.debug('mesh', 'batman-adv module loaded')

    // Bring mesh interface down for reconfiguration
    await execAsync(`sudo ip link set ${iface} down`)

    // Set to IBSS (ad-hoc) mode for mesh
    await execAsync(`sudo iw ${iface} set type ibss`)

    // Bring interface up
    await execAsync(`sudo ip link set ${iface} up`)

    // Join the village mesh IBSS
    await execAsync(`sudo iw ${iface} ibss join ${ssid} ${config.network.meshChannel}`)

    // Add interface to batman-adv
    await execAsync(`sudo batctl if add ${iface}`)

    // Bring bat0 interface up
    await execAsync('sudo ip link set bat0 up')

    // Assign IP address to bat0
    await execAsync(`sudo ip addr add ${ip}/24 dev bat0`)

    logger.info('mesh', `Mesh initialized — bat0 at ${ip}`)
    return true

  } catch (err) {
    logger.error('mesh', 'Mesh initialization failed', { error: err.message })
    return false
  }
}

// ── Peer count ────────────────────────────────────────────────────────────────

export async function getMeshPeerCount() {
  try {
    const { stdout } = await execAsync('sudo batctl n')
    // Count lines that look like MAC addresses (neighbor entries)
    const peers = stdout
      .split('\n')
      .filter(line => /([0-9a-f]{2}:){5}[0-9a-f]{2}/i.test(line))
    return peers.length
  } catch {
    return 0
  }
}

// ── Mesh topology ─────────────────────────────────────────────────────────────

export async function getMeshTopology() {
  try {
    const { stdout } = await execAsync('sudo batctl o')
    const lines = stdout.split('\n').filter(l => l.trim() && !l.startsWith('['))

    const nodes = lines.map(line => {
      const parts = line.trim().split(/\s+/)
      return {
        mac:      parts[0] ?? null,
        lastSeen: parts[1] ?? null,
        quality:  parts[2] ? parseInt(parts[2]) : null,
        nextHop:  parts[3] ?? null,
        iface:    parts[4] ?? null,
      }
    }).filter(n => n.mac)

    return nodes
  } catch {
    return []
  }
}

// ── Mesh health ───────────────────────────────────────────────────────────────

export async function getMeshHealth() {
  try {
    const [peerCount, topology] = await Promise.all([
      getMeshPeerCount(),
      getMeshTopology(),
    ])

    return {
      online:    peerCount > 0,
      peerCount,
      nodeCount: topology.length,
      topology,
    }
  } catch (err) {
    logger.warn('mesh', 'Health check failed', { error: err.message })
    return { online: false, peerCount: 0, nodeCount: 0, topology: [] }
  }
}

// ── Mesh restart ──────────────────────────────────────────────────────────────

export async function restartMesh() {
  logger.warn('mesh', 'Restarting mesh daemon')
  try {
    const iface = config.network.meshInterface

    await execAsync('sudo ip link set bat0 down')
    await execAsync(`sudo batctl if del ${iface}`)
    await execAsync(`sudo ip link set ${iface} down`)

    // Brief pause before reinit
    await new Promise(r => setTimeout(r, 2000))

    return await initMesh()
  } catch (err) {
    logger.error('mesh', 'Mesh restart failed', { error: err.message })
    return false
  }
}

// ── Interface check ───────────────────────────────────────────────────────────

export async function isMeshUp() {
  try {
    const { stdout } = await execAsync('ip link show bat0')
    return stdout.includes('UP')
  } catch {
    return false
  }
}
