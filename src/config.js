import "dotenv/config";

function require(key) {
  const val = process.env[key];
  if (!val) throw new Error(`[config] Missing required env var: ${key}`);
  return val;
}

function optional(key, fallback = null) {
  return process.env[key] ?? fallback;
}

export const config = {
  node: {
    id: require("NODE_ID"),
    uuid: require("NODE_UUID"),
    name: require("NODE_NAME"),
    type: optional("NODE_TYPE", "anchor"),
    address: optional("ADDRESS"),
    neighborhood: optional("NEIGHBORHOOD"),
    anchorSite: optional("ANCHOR_SITE"),
  },
  location: {
    lat: parseFloat(require("LATITUDE")),
    lng: parseFloat(require("LONGITUDE")),
  },
  supabase: {
    url: require("SUPABASE_URL"),
    anonKey: require("SUPABASE_ANON_KEY"),
    serviceRoleKey: optional("SUPABASE_SERVICE_ROLE_KEY"),
  },
  fcc: {
    dbUrl: optional("FCC_DB_URL", null),
    apiKey: optional("FCC_API_KEY", null),
    queryIntervalMs: parseInt(optional("FCC_QUERY_INTERVAL_MS", "3600000")),
    staticChannelNum: parseInt(optional("STATIC_TVWS_CHANNEL", "19")),
    staticFrequencyMhz: parseFloat(
      optional("STATIC_TVWS_FREQUENCY_MHZ", "530"),
    ),
    staticPowerDbw: parseFloat(optional("STATIC_TVWS_POWER_DBW", "6")),
  },
  network: {
    tvwsInterface: optional("TVWS_INTERFACE", "wlan0"),
    meshInterface: optional("MESH_INTERFACE", "wlan1"),
    meshIp: optional("MESH_IP", "10.10.0.1"),
    meshSsid: optional("MESH_SSID", "village-mesh"),
    meshChannel: optional("MESH_CHANNEL", "2412"),
  },
  timing: {
    heartbeatMs: parseInt(optional("HEARTBEAT_INTERVAL_MS", "60000")),
    cacheSyncMs: parseInt(optional("CACHE_SYNC_INTERVAL_MS", "21600000")),
  },
  cache: {
    dir: optional("CACHE_DIR", "/opt/village-node/cache"),
    maxGb: parseInt(optional("CACHE_MAX_GB", "8")),
  },
  log: {
    level: optional("LOG_LEVEL", "info"),
  },
};
