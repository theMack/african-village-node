import { createClient } from '@supabase/supabase-js'
import { config } from './config.js'
import { logger } from './logger.js'

export const supabase = createClient(config.supabase.url, config.supabase.anonKey)

// ── Node registry ─────────────────────────────────────────────────────────────

export async function registerNode(nodeData) {
  const { error } = await supabase
    .from('nodes')
    .upsert({
      node_id:          config.node.id,
      node_name:        config.node.name,
      node_type:        config.node.type,
      address:          config.node.address,
      neighborhood:     config.node.neighborhood,
      anchor_site:      config.node.anchorSite,
      status:           'active',
      location:         `POINT(${config.location.lng} ${config.location.lat})`,
      hardware_version: nodeData.hardwareVersion ?? '1.0',
      firmware_version: nodeData.firmwareVersion ?? process.version,
      last_heartbeat:   new Date().toISOString(),
    }, { onConflict: 'node_id' })

  if (error) {
    logger.error('supabase', 'Node registration failed', { error: error.message })
    return false
  }

  logger.info('supabase', `Node registered: ${config.node.id}`)
  return true
}

export async function updateHeartbeat(telemetry) {
  const { error } = await supabase
    .from('nodes')
    .update({
      status:         'active',
      last_heartbeat: new Date().toISOString(),
      tvws_channel:   telemetry.tvwsChannel ?? null,
      tvws_frequency_mhz: telemetry.tvwsFrequencyMhz ?? null,
    })
    .eq('node_id', config.node.id)

  if (error) {
    logger.error('supabase', 'Heartbeat update failed', { error: error.message })
    return false
  }

  return true
}

export async function updateStatus(status) {
  const { error } = await supabase
    .from('nodes')
    .update({ status, last_heartbeat: new Date().toISOString() })
    .eq('node_id', config.node.id)

  if (error) {
    logger.error('supabase', 'Status update failed', { error: error.message })
  }
}

// ── Telemetry ─────────────────────────────────────────────────────────────────

export async function writeTelemetry(telemetry) {
  const { error } = await supabase
    .from('node_telemetry')
    .insert({
      node_id:            config.node.id,
      tvws_channel:       telemetry.tvwsChannel,
      tvws_frequency_mhz: telemetry.tvwsFrequencyMhz,
      tvws_power_dbm:     telemetry.tvwsPowerDbm,
      mesh_peers:         telemetry.meshPeers,
      uptime_seconds:     Math.floor(process.uptime()),
      recorded_at:        new Date().toISOString(),
    })

  if (error) {
    logger.warn('supabase', 'Telemetry write failed', { error: error.message })
  }
}

// ── Signal Bus ────────────────────────────────────────────────────────────────

export async function dispatchSignal(channel, eventType, payload) {
  const { error } = await supabase
    .from('signal_events')
    .insert({
      channel,
      event_type: eventType,
      source:     config.node.id,
      payload,
      created_at: new Date().toISOString(),
    })

  if (error) {
    logger.warn('supabase', 'Signal dispatch failed', { channel, eventType, error: error.message })
    return false
  }

  logger.debug('supabase', `Signal dispatched: ${channel}/${eventType}`)
  return true
}

// ── Spectrum log ──────────────────────────────────────────────────────────────

export async function logSpectrumQuery(channels) {
  const { error } = await supabase
    .from('spectrum_log')
    .insert({
      node_id:            config.node.id,
      available_channels: channels,
      queried_at:         new Date().toISOString(),
    })

  if (error) {
    logger.warn('supabase', 'Spectrum log write failed', { error: error.message })
  }
}
