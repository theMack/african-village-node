# African Village Node Agent

Node.js daemon for Raspberry Pi 4B nodes in The African Village TVWS mesh network.

**Platform:** theafricanvillage.org  
**Kernel repo:** github.com/theMack/african-village  
**Node 001:** 2317 West Chestnut Street, Russell, Louisville KY  
**FCC License:** 0667-EX-CN-2026

---

## What it does

The node agent runs on each physical Raspberry Pi node and handles:

- **TVWS spectrum** — queries the FCC geolocation database for available channels, selects the optimal channel, and configures the radio interface
- **MaNet mesh** — initializes and monitors Batman-adv mesh routing
- **Heartbeat** — reports telemetry to Supabase every 60 seconds
- **Signal Bus** — dispatches node online/offline/fault events to the village kernel
- **Media cache** — syncs broadcast content from Supabase Storage for local playback

---

## Hardware

| Component | Spec |
|-----------|------|
| Compute | Raspberry Pi 4B (4GB RAM) |
| OS | Raspberry Pi OS Lite 64-bit (Debian Bookworm) |
| TVWS radio | Carlson Wireless AG50 (FCC certified) |
| Mesh radio | Ubiquiti UniFi AC Mesh or Alfa AWUS036ACM |
| Mesh protocol | Batman-adv (802.11s) |

See [african-village/docs/hardware-bom.md](https://github.com/theMack/african-village/blob/main/docs/hardware-bom.md) for full bill of materials.

---

## Quick install

On a fresh Raspberry Pi OS Lite installation:

```bash
curl -fsSL https://raw.githubusercontent.com/theMack/african-village-node/main/scripts/install.sh | sudo bash
```

Or manually:

```bash
sudo git clone https://github.com/theMack/african-village-node.git /opt/village-node
cd /opt/village-node
sudo npm install --production
sudo cp .env.example .env
sudo nano .env   # fill in your node configuration
sudo cp systemd/village-node.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now village-node
```

---

## Configuration

Copy `.env.example` to `.env` and set:

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ID` | ✓ | Unique node identifier (e.g. `NODE-001`) |
| `NODE_NAME` | ✓ | Human-readable name (e.g. `Russell Anchor`) |
| `LATITUDE` | ✓ | Decimal degrees (for FCC DB query) |
| `LONGITUDE` | ✓ | Decimal degrees (for FCC DB query) |
| `SUPABASE_URL` | ✓ | Village Supabase project URL |
| `SUPABASE_ANON_KEY` | ✓ | Supabase anon key |
| `TVWS_INTERFACE` | | TVWS radio interface (default: `wlan0`) |
| `MESH_INTERFACE` | | Mesh radio interface (default: `wlan1`) |
| `MESH_IP` | | Node IP on bat0 (default: `10.10.0.1`) |
| `HEARTBEAT_INTERVAL_MS` | | Telemetry interval (default: `60000`) |

---

## File structure

```
african-village-node/
├── src/
│   ├── agent.js        # Main daemon — boot sequence and lifecycle
│   ├── config.js       # Environment configuration loader
│   ├── logger.js       # Structured logging
│   ├── supabase.js     # Supabase client and DB operations
│   ├── spectrum.js     # FCC geolocation DB query + radio config
│   ├── mesh.js         # Batman-adv mesh management
│   ├── heartbeat.js    # Supabase telemetry loop
│   └── cache.js        # Local media cache sync
├── systemd/
│   └── village-node.service   # systemd unit file
├── scripts/
│   ├── install.sh      # One-command installation
│   └── status.sh       # Node status check
├── .env.example        # Environment variable template
└── package.json
```

---

## Boot sequence

1. Register node with Supabase (`nodes` table upsert)
2. Query FCC geolocation database for available TVWS channels
3. Select optimal channel and configure TVWS radio
4. Initialize Batman-adv MaNet mesh on `wlan1`
5. Initialize local media cache directory
6. Dispatch `node:online` to `village:infrastructure:node` Signal Bus channel
7. Start heartbeat loop (every 60s)
8. Start cache sync (every 6h)
9. Schedule spectrum refresh (every 60min)

---

## Operations

```bash
# Start
sudo systemctl start village-node

# Stop
sudo systemctl stop village-node

# View live logs
sudo journalctl -u village-node -f

# Node status
bash scripts/status.sh

# Check mesh peers
sudo batctl n

# Check originator table (all reachable nodes)
sudo batctl o
```

---

## Signal Bus events dispatched

| Event | Channel | Trigger |
|-------|---------|---------|
| `node:online` | `village:infrastructure:node` | Successful boot |
| `node:offline` | `village:infrastructure:node` | Graceful shutdown |
| `node:fault:no_channels` | `village:infrastructure:node` | No TVWS channels available |
| `node:fault:mesh_down` | `village:infrastructure:node` | Mesh initialization failed |
| `node:fault:heartbeat` | `village:infrastructure:node` | 3+ consecutive heartbeat failures |
| `node:fault:crash` | `village:infrastructure:node` | Uncaught exception |
| `node:fault:boot` | `village:infrastructure:node` | Boot sequence failure |

---

## License

GPL-3.0 — The African Village Cooperative
