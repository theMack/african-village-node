/**
 * African Village Node Agent
 * Main daemon — boots, initializes all subsystems, and runs the heartbeat loop
 *
 * Subsystems:
 *   spectrum  — FCC geolocation DB query + TVWS radio configuration
 *   mesh      — Batman-adv MaNet mesh initialization and monitoring
 *   heartbeat — Supabase telemetry loop (every 60s)
 *   cache     — Local media cache sync (every 6h)
 *
 * Signal Bus channels dispatched:
 *   village:infrastructure:node — node online/offline/fault events
 */

import { config } from './config.js'
import { logger } from './logger.js'
import { registerNode, updateStatus, dispatchSignal } from './supabase.js'
import { queryAvailableChannels, selectOptimalChannel, configureRadio, refreshSpectrum } from './spectrum.js'
import { initMesh, getMeshHealth } from './mesh.js'
import { startHeartbeat, stopHeartbeat } from './heartbeat.js'
import { initCache, startCacheSync, stopCacheSync } from './cache.js'

// ── Boot banner ───────────────────────────────────────────────────────────────

function banner() {
  console.log('╔══════════════════════════════════════════╗')
  console.log('║   The African Village — Node Agent        ║')
  console.log(`║   ${config.node.id.padEnd(40)}║`)
  console.log(`║   ${config.node.name.padEnd(40)}║`)
  console.log(`║   ${config.node.address?.padEnd(40) ?? ''.padEnd(40)}║`)
  console.log('╚══════════════════════════════════════════╝')
}

// ── Boot sequence ─────────────────────────────────────────────────────────────

async function boot() {
  banner()
  logger.info('agent', 'Boot sequence starting')

  // 1. Register node with Supabase
  logger.info('agent', 'Registering node with village kernel')
  const registered = await registerNode({
    hardwareVersion: '1.0',
    firmwareVersion: process.version,
  })
  if (!registered) {
    logger.warn('agent', 'Node registration failed — continuing with degraded telemetry')
  }

  // 2. Query FCC geolocation database for available TVWS channels
  logger.info('agent', 'Querying FCC geolocation database')
  const channels = await queryAvailableChannels()

  if (!channels.length) {
    logger.error('agent', 'No TVWS channels available — cannot proceed with transmission')
    await dispatchSignal('village:infrastructure:node', 'node:fault:no_channels', {
      node_id: config.node.id,
      location: config.location,
    })
    // Continue boot — mesh and telemetry can still function
  } else {
    // 3. Select and configure optimal TVWS channel
    const optimal = selectOptimalChannel(channels)
    logger.info('agent', `Selected channel ${optimal.channel} (${optimal.frequencyMhz} MHz)`)

    const radioConfigured = await configureRadio(optimal)
    if (!radioConfigured) {
      logger.warn('agent', 'Radio configuration failed — node will not transmit TVWS')
    }
  }

  // 4. Initialize MaNet mesh
  logger.info('agent', 'Initializing MaNet mesh (batman-adv)')
  const meshUp = await initMesh()

  if (!meshUp) {
    logger.warn('agent', 'Mesh initialization failed — node isolated')
    await dispatchSignal('village:infrastructure:node', 'node:fault:mesh_down', {
      node_id: config.node.id,
    })
  } else {
    const health = await getMeshHealth()
    logger.info('agent', `Mesh up — ${health.peerCount} peers visible`)
  }

  // 5. Initialize local media cache
  logger.info('agent', 'Initializing media cache')
  initCache()

  // 6. Dispatch node:online signal
  await dispatchSignal('village:infrastructure:node', 'node:online', {
    node_id:      config.node.id,
    node_name:    config.node.name,
    neighborhood: config.node.neighborhood,
    mesh_up:      meshUp,
    location:     config.location,
    timestamp:    new Date().toISOString(),
  })

  // 7. Start heartbeat loop
  logger.info('agent', 'Starting heartbeat loop')
  startHeartbeat()

  // 8. Start cache sync
  logger.info('agent', 'Starting cache sync')
  startCacheSync()

  // 9. Schedule spectrum refresh
  logger.info('agent', `Scheduling spectrum refresh every ${config.fcc.queryIntervalMs / 60000}min`)
  setInterval(refreshSpectrum, config.fcc.queryIntervalMs)

  logger.info('agent', '✓ Boot complete — all systems nominal')
  await updateStatus('active')
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown(signal) {
  logger.info('agent', `Received ${signal} — shutting down gracefully`)

  stopHeartbeat()
  stopCacheSync()

  await Promise.all([
    updateStatus('inactive'),
    dispatchSignal('village:infrastructure:node', 'node:offline', {
      node_id:  config.node.id,
      reason:   signal,
      uptime:   Math.floor(process.uptime()),
    }),
  ])

  logger.info('agent', 'Shutdown complete')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))

// ── Unhandled error safety net ────────────────────────────────────────────────

process.on('uncaughtException', async (err) => {
  logger.error('agent', 'Uncaught exception', { error: err.message, stack: err.stack })
  await dispatchSignal('village:infrastructure:node', 'node:fault:crash', {
    node_id: config.node.id,
    error:   err.message,
  }).catch(() => {})
  process.exit(1)
})

process.on('unhandledRejection', async (reason) => {
  logger.error('agent', 'Unhandled rejection', { reason: String(reason) })
})

// ── Start ─────────────────────────────────────────────────────────────────────

boot().catch(async (err) => {
  logger.error('agent', 'Boot failed', { error: err.message })
  await dispatchSignal('village:infrastructure:node', 'node:fault:boot', {
    node_id: config.node.id,
    error:   err.message,
  }).catch(() => {})
  process.exit(1)
})
