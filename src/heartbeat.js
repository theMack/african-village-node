import { config } from "./config.js";
import { logger } from "./logger.js";
import { updateHeartbeat, writeTelemetry, dispatchSignal } from "./supabase.js";
import {
  getCurrentChannel,
  getCurrentFrequency,
  getSignalStrength,
} from "./spectrum.js";
import { getMeshPeerCount, isMeshUp } from "./mesh.js";

let heartbeatInterval = null;
let consecutiveFaults = 0;
let beatCount = 0;
const MAX_FAULTS_BEFORE_ALERT = 3;

// ── Single heartbeat ──────────────────────────────────────────────────────────

export async function beat() {
  const [meshPeers, meshUp, signalStrength] = await Promise.all([
    getMeshPeerCount(),
    isMeshUp(),
    getSignalStrength(),
  ]);

  const telemetry = {
    tvwsChannel: getCurrentChannel(),
    tvwsFrequencyMhz: getCurrentFrequency(),
    tvwsPowerDbm: signalStrength,
    meshPeers,
    meshUp,
    uptimeSeconds: Math.floor(process.uptime()),
  };

  const success = await updateHeartbeat(telemetry);

  if (success) {
    consecutiveFaults = 0;
    logger.debug(
      "heartbeat",
      `Beat ${beatCount} — peers: ${meshPeers}, ch: ${telemetry.tvwsChannel}, uptime: ${telemetry.uptimeSeconds}s`,
    );

    // Write detailed telemetry every 5 beats
    if (beatCount % 5 === 0) {
      await writeTelemetry(telemetry);
    }
  } else {
    consecutiveFaults++;
    logger.warn(
      "heartbeat",
      `Fault ${consecutiveFaults}/${MAX_FAULTS_BEFORE_ALERT}`,
    );

    if (consecutiveFaults >= MAX_FAULTS_BEFORE_ALERT) {
      await dispatchSignal(
        "village:infrastructure:node",
        "node:fault:heartbeat",
        {
          node_id: config.node.id,
          fault_count: consecutiveFaults,
          last_uptime: Math.floor(process.uptime()),
        },
      );
    }
  }

  beatCount++;
  return success;
}

// ── Start/stop ────────────────────────────────────────────────────────────────

export function startHeartbeat() {
  if (heartbeatInterval) return;
  logger.info(
    "heartbeat",
    `Starting — interval: ${config.timing.heartbeatMs}ms`,
  );
  beat();
  heartbeatInterval = setInterval(beat, config.timing.heartbeatMs);
}

export function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    logger.info("heartbeat", "Stopped");
  }
}
