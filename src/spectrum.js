import { execSync } from "child_process";
import { promisify } from "util";
import { exec } from "child_process";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { logSpectrumQuery } from "./supabase.js";

const execAsync = promisify(exec);

// Current channel state
let currentChannel = null;
let currentFrequencyMhz = null;
let lastQueryTime = null;

// ── Static channel (FCC license 0667-EX-CN-2026, 530 MHz) ────────────────────

function getStaticChannel() {
  return {
    channel: config.fcc.staticChannelNum,
    frequencyMhz: config.fcc.staticFrequencyMhz,
    maxPowerDbw: config.fcc.staticPowerDbw,
    source: "static_license",
  };
}

// ── FCC geolocation DB query ──────────────────────────────────────────────────

async function queryDatabase() {
  const url = `${config.fcc.dbUrl}/tvws/channels?lat=${config.location.lat}&lng=${config.location.lng}&deviceType=fixed&heightAboveTerrain=10`;

  logger.info(
    "spectrum",
    `Querying FCC geolocation DB for ${config.location.lat}, ${config.location.lng}`,
  );

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      ...(config.fcc.apiKey
        ? { Authorization: `Bearer ${config.fcc.apiKey}` }
        : {}),
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) throw new Error(`FCC DB returned ${response.status}`);

  const data = await response.json();
  const channels = data.availableChannels ?? [];
  return channels.filter((ch) => ch.maxPowerDbw >= 6);
}

// ── Primary export: query available channels ──────────────────────────────────

export async function queryAvailableChannels() {
  // No DB URL configured — use static licensed channel
  if (!config.fcc.dbUrl) {
    const ch = getStaticChannel();
    logger.info(
      "spectrum",
      `No FCC DB configured — using static licensed channel`,
      {
        channel: ch.channel,
        frequencyMhz: ch.frequencyMhz,
        license: "0667-EX-CN-2026",
      },
    );
    lastQueryTime = Date.now();
    await logSpectrumQuery([ch]);
    return [ch];
  }

  try {
    const viable = await queryDatabase();
    logger.info("spectrum", `${viable.length} viable channels found`);
    lastQueryTime = Date.now();
    await logSpectrumQuery(viable);
    return viable;
  } catch (err) {
    logger.error("spectrum", "FCC DB query failed", { error: err.message });

    // Fall back to last known channel, then static
    if (currentChannel) {
      logger.warn(
        "spectrum",
        `Using last known channel ${currentChannel} as fallback`,
      );
      return [
        {
          channel: currentChannel,
          frequencyMhz: currentFrequencyMhz,
          maxPowerDbw: 6,
        },
      ];
    }

    logger.warn("spectrum", "Falling back to static licensed channel");
    return [getStaticChannel()];
  }
}

// ── Channel selection ─────────────────────────────────────────────────────────

export function selectOptimalChannel(channels) {
  if (!channels.length) return null;
  const sorted = [...channels].sort((a, b) => {
    if (b.maxPowerDbw !== a.maxPowerDbw) return b.maxPowerDbw - a.maxPowerDbw;
    return a.channel - b.channel;
  });
  return sorted[0];
}

// ── Radio configuration ───────────────────────────────────────────────────────

export async function configureRadio(channel) {
  if (!channel) {
    logger.error("spectrum", "Cannot configure radio — no channel available");
    return false;
  }

  const iface = config.network.tvwsInterface;
  logger.info(
    "spectrum",
    `Configuring ${iface} on channel ${channel.channel} (${channel.frequencyMhz} MHz)`,
  );

  try {
    await execAsync(`sudo ip link set ${iface} down`);
    await execAsync(`sudo iw ${iface} set type managed`);
    await execAsync(`sudo ip link set ${iface} up`);
    const freqKhz = channel.frequencyMhz * 1000;
    await execAsync(`sudo iw ${iface} set freq ${freqKhz}`);

    currentChannel = channel.channel;
    currentFrequencyMhz = channel.frequencyMhz;

    logger.info(
      "spectrum",
      `Radio configured: channel ${currentChannel}, ${currentFrequencyMhz} MHz`,
    );
    return true;
  } catch (err) {
    logger.error("spectrum", "Radio configuration failed", {
      error: err.message,
    });
    return false;
  }
}

// ── Signal strength ───────────────────────────────────────────────────────────

export async function getSignalStrength() {
  const iface = config.network.tvwsInterface;
  try {
    const { stdout } = await execAsync(`iw ${iface} station dump`);
    const match = stdout.match(/signal:\s+([-\d]+)\s+dBm/);
    return match ? parseInt(match[1]) : null;
  } catch {
    return null;
  }
}

// ── Getters ───────────────────────────────────────────────────────────────────

export function getCurrentChannel() {
  return currentChannel;
}
export function getCurrentFrequency() {
  return currentFrequencyMhz;
}
export function getLastQueryTime() {
  return lastQueryTime;
}

// ── Scheduled re-query ────────────────────────────────────────────────────────

export async function refreshSpectrum() {
  const channels = await queryAvailableChannels();
  const optimal = selectOptimalChannel(channels);

  if (!optimal) {
    logger.warn("spectrum", "No viable channels found on re-query");
    return false;
  }

  if (optimal.channel !== currentChannel) {
    logger.info(
      "spectrum",
      `Channel change: ${currentChannel} → ${optimal.channel}`,
    );
    return await configureRadio(optimal);
  }

  logger.debug(
    "spectrum",
    `Channel ${currentChannel} still optimal — no change`,
  );
  return true;
}
