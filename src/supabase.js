import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import { logger } from "./logger.js";

// Anon client — for reads and any RLS-permitted operations
export const supabase = createClient(
  config.supabase.url,
  config.supabase.anonKey,
);

// Service role client — bypasses RLS for node write operations
// Falls back to anon client if service role key not configured
const supabaseAdmin = config.supabase.serviceRoleKey
  ? createClient(config.supabase.url, config.supabase.serviceRoleKey)
  : supabase;

if (!config.supabase.serviceRoleKey) {
  logger.warn(
    "supabase",
    "SUPABASE_SERVICE_ROLE_KEY not set — using anon key for writes (RLS must permit)",
  );
}

// ── Node registry ─────────────────────────────────────────────────────────────
// Row already exists in nodes table — update by uuid, never insert

export async function registerNode(nodeData) {
  const { error } = await supabaseAdmin
    .from("nodes")
    .update({
      status: "online",
      hardware_version: nodeData.hardwareVersion ?? "1.0",
      firmware_version: nodeData.firmwareVersion ?? process.version,
      last_heartbeat: new Date().toISOString(),
    })
    .eq("id", config.node.uuid);

  if (error) {
    logger.error("supabase", "Node registration failed", {
      error: error.message,
    });
    return false;
  }

  logger.info(
    "supabase",
    `Node registered: ${config.node.name} (${config.node.uuid})`,
  );
  return true;
}

export async function updateHeartbeat(telemetry) {
  const { error } = await supabaseAdmin
    .from("nodes")
    .update({
      status: "online",
      last_heartbeat: new Date().toISOString(),
      tvws_channel: telemetry.tvwsChannel ?? null,
    })
    .eq("id", config.node.uuid);

  if (error) {
    logger.error("supabase", "Heartbeat update failed", {
      error: error.message,
    });
    return false;
  }

  return true;
}

export async function updateStatus(status) {
  const { error } = await supabaseAdmin
    .from("nodes")
    .update({ status, last_heartbeat: new Date().toISOString() })
    .eq("id", config.node.uuid);

  if (error) {
    logger.error("supabase", "Status update failed", { error: error.message });
  }
}

// ── Telemetry ─────────────────────────────────────────────────────────────────

export async function writeTelemetry(telemetry) {
  const { error } = await supabaseAdmin.from("node_telemetry").insert({
    node_id: config.node.uuid,
    timestamp: new Date().toISOString(),
    signal_strength_dbm: telemetry.tvwsPowerDbm ?? null,
    mesh_peer_count: telemetry.meshPeers ?? 0,
    tvws_channel: telemetry.tvwsChannel ?? null,
    uptime_seconds: Math.floor(process.uptime()),
  });

  if (error) {
    logger.warn("supabase", "Telemetry write failed", { error: error.message });
  }
}

// ── Signal Bus ────────────────────────────────────────────────────────────────

export async function dispatchSignal(channel, eventType, payload) {
  const { error } = await supabaseAdmin.from("signal_events").insert({
    channel,
    event_type: eventType,
    publisher_pillar: "infrastructure",
    payload,
    published_at: new Date().toISOString(),
  });

  if (error) {
    logger.warn("supabase", "Signal dispatch failed", {
      channel,
      eventType,
      error: error.message,
    });
    return false;
  }

  logger.debug("supabase", `Signal dispatched: ${channel}/${eventType}`);
  return true;
}

// ── Spectrum log ──────────────────────────────────────────────────────────────

export async function logSpectrumQuery(channels) {
  const selected = channels[0] ?? null;

  const { error } = await supabaseAdmin.from("spectrum_log").insert({
    node_id: config.node.uuid,
    timestamp: new Date().toISOString(),
    available_channels: channels,
    selected_channel: selected?.channel ?? null,
    max_power_dbm: selected?.maxPowerDbw ? selected.maxPowerDbw * 10 : null,
    database_provider: "fcc_geolocation",
  });

  if (error) {
    logger.warn("supabase", "Spectrum log write failed", {
      error: error.message,
    });
  }
}
