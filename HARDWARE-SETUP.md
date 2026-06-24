# Node 001 — Hardware Setup Guide

## 2317 West Chestnut Street, Russell, Louisville KY

## African Village Node Agent · FCC License 0667-EX-CN-2026

---

## Bill of Materials

| #   | Component             | Model                                   | Purpose                |
| --- | --------------------- | --------------------------------------- | ---------------------- |
| 1   | Single-board computer | Raspberry Pi 4B (4GB or 8GB)            | Node compute           |
| 2   | Storage               | 64GB+ microSD (A2 rated) or USB 3.0 SSD | OS + agent + cache     |
| 3   | TVWS radio            | Carlson Wireless AG50                   | 530 MHz UHF broadcast  |
| 4   | Mesh radio            | Alfa AWUS036ACM                         | batman-adv 802.11ac    |
| 5   | Power                 | Official Pi 4 USB-C PSU (5V/3A)         | Stable compute power   |
| 6   | Cooling               | Heatsinks + 5V fan                      | Thermal management     |
| 7   | Enclosure             | Weatherproof IP65 box                   | Outdoor/attic mounting |
| 8   | Ethernet              | Cat6 patch cable                        | Backhaul (optional)    |
| 9   | Antenna               | AG50 supplied antenna or outdoor whip   | TVWS signal            |
| —   | Future                | Nucleo MB1136 C-04 (STM32)              | Watchdog / power mgmt  |

---

## Physical Setup

### Step 1 — Flash the OS

1. Download **Raspberry Pi OS Lite (64-bit, Bookworm)** from raspberrypi.com
2. Flash to microSD using Raspberry Pi Imager
3. In Imager advanced settings (gear icon):
   - Set hostname: `village-node-001`
   - Enable SSH; set username `pi` and a strong password
   - Configure WiFi only if you have no Ethernet for initial setup
4. Insert microSD, connect Ethernet, power on

```bash
# Verify 64-bit OS after boot
uname -m
# Expected: aarch64
```

### Step 2 — Initial system hardening

```bash
# Update everything
sudo apt update && sudo apt full-upgrade -y

# Set timezone
sudo timedatectl set-timezone America/Kentucky/Louisville

# Enable NTP
sudo systemctl enable --now systemd-timesyncd

# Expand filesystem (if not auto-expanded)
sudo raspi-config nonint do_expand_rootfs
sudo reboot
```

### Step 3 — Identify radio interfaces

After boot, confirm both USB radios are recognized:

```bash
lsusb
# Should show:
#   Ralink Technology RT5572 (Alfa AWUS036ACM) or similar
#   AG50 USB device

ip link show
# Should show wlan0 (onboard or first USB) and wlan1 (second USB)

iw dev
# Shows both wireless interfaces with MAC addresses
```

**Map interfaces to radios:**

- `wlan0` → TVWS radio (Carlson AG50) — used for licensed spectrum
- `wlan1` → Mesh radio (Alfa AWUS036ACM) — used for batman-adv

If the mapping is reversed, update `TVWS_IFACE` and `MESH_IFACE` in `.env`.

### Step 4 — Prevent interface renaming

```bash
sudo nano /etc/udev/rules.d/72-village-radios.rules
```

Add (replace MAC addresses with your actual values from `iw dev`):

```
SUBSYSTEM=="net", ACTION=="add", ATTR{address}=="aa:bb:cc:dd:ee:ff", NAME="wlan0"
SUBSYSTEM=="net", ACTION=="add", ATTR{address}=="11:22:33:44:55:66", NAME="wlan1"
```

```bash
sudo reboot
# Verify: ip link show wlan0 wlan1
```

### Step 5 — Install the agent

```bash
cd ~
git clone https://github.com/theMack/african-village-node.git
cd african-village-node
sudo bash scripts/install.sh
```

### Step 6 — Configure environment

```bash
sudo nano /opt/african-village-node/.env
```

Required values to fill in:

```bash
NODE_ID=NODE-001
NODE_NAME=Russell Anchor
ADDRESS=2317 West Chestnut Street
NEIGHBORHOOD=Russell
LATITUDE=38.2527
LONGITUDE=-85.7585

SUPABASE_URL=https://vctwodqmyrukatmpexkt.supabase.co
SUPABASE_ANON_KEY=<your anon key from Supabase dashboard>
SUPABASE_SERVICE_ROLE_KEY=<your service role key>

TVWS_IFACE=wlan0
MESH_IFACE=wlan1
FCC_LICENSE=0667-EX-CN-2026
```

### Step 7 — Grant sudo for radio control

The agent uses `iw`, `ip`, and `batctl` which require root. Create a sudoers rule:

```bash
sudo visudo -f /etc/sudoers.d/village-node
```

Add:

```
pi ALL=(ALL) NOPASSWD: /usr/sbin/iw, /usr/sbin/ip, /usr/sbin/batctl, /usr/bin/batctl
```

### Step 8 — Start and verify

```bash
sudo systemctl start village-node
sudo journalctl -u village-node -f
```

Expected boot log sequence:

```
{"level":"info","module":"agent","message":"African Village Node Agent starting"...}
{"level":"info","module":"supabase","message":"Node registered"...}
{"level":"info","module":"spectrum","message":"Querying FCC geolocation DB"...}
{"level":"info","module":"spectrum","message":"Best TVWS channel selected"...}
{"level":"info","module":"mesh","message":"batman-adv mesh initialized"...}
{"level":"info","module":"agent","message":"Node agent fully operational"...}
```

Verify in Supabase:

- `nodes` table: NODE-001 row with `status: active`
- `signal_events` table: `node:online` event
- `node_telemetry`: first heartbeat row within 60s

---

## Physical Antenna Placement

### AG50 TVWS antenna (530 MHz)

- Mount outdoors or in attic if possible — every meter of height adds coverage
- Face toward open sky, away from large metal objects
- Minimum 3m separation from Alfa antenna to reduce interference
- Connect to AG50 via supplied N-type or SMA cable per AG50 datasheet

### Alfa AWUS036ACM mesh antenna

- Dual-band 802.11ac — position for line-of-sight toward future node sites
- Indoor attic placement acceptable for mesh, outdoor preferred
- Can be repositioned without software changes

---

## Thermal Management

The Pi 4B runs warm under load. Node 001 is a 24/7 daemon.

```bash
# Monitor temperature
watch -n 5 "cat /sys/class/thermal/thermal_zone0/temp | awk '{print \$1/1000\"°C\"}'"

# Throttle check (0 = no throttle)
vcgencmd get_throttled
```

- Install aluminum heatsinks on CPU, RAM, and USB/Ethernet chip
- Add a 5V 40mm fan in the enclosure
- Target operating temp: below 70°C
- At 80°C+ the Pi throttles — the heartbeat will log this via cpu_temp_c

---

## Watchdog (Software)

Enable the Pi's hardware watchdog so the board resets on lockup:

```bash
sudo nano /etc/systemd/system.conf
# Set: RuntimeWatchdogSec=15s

# Also enable kernel watchdog
echo 'dtparam=watchdog=on' | sudo tee -a /boot/firmware/config.txt
sudo reboot
```

---

## Troubleshooting

| Symptom                      | Likely cause                       | Fix                                                            |
| ---------------------------- | ---------------------------------- | -------------------------------------------------------------- |
| `No available TVWS channels` | FCC DB unreachable or coords wrong | Check internet, verify LAT/LON                                 |
| `Mesh init failed`           | wlan1 in use / wrong mode          | `sudo ip link set wlan1 down; sudo iw dev wlan1 set type ibss` |
| `register_node` error        | Bad Supabase key                   | Check `.env` keys                                              |
| `iw channel set failed`      | wlan0 locked by NetworkManager     | Disable NM for wlan0 (see below)                               |
| Agent won't start            | systemd `EnvironmentFile` missing  | Verify `.env` exists at install path                           |

### Disable NetworkManager for radio interfaces

```bash
sudo nano /etc/NetworkManager/conf.d/village-node.conf
```

```ini
[keyfile]
unmanaged-devices=interface-name:wlan0;interface-name:wlan1;interface-name:bat0
```

```bash
sudo systemctl restart NetworkManager
```

---

## Nucleo MB1136 C-04 (STM32) — Future Integration

The Nucleo board is **not part of the current node stack** but is architected for:

- **Hardware watchdog** — UART ping from Pi; Nucleo cuts and restores power on timeout
- **Power management** — Controlled shutdown/wake on schedule or low-voltage event
- **GPIO bridge** — Physical status LEDs, alert buzzer, manual reboot button

Planned integration path:

1. Pi ↔ Nucleo via UART (`/dev/ttyAMA0` at 115200 baud)
2. `src/watchdog.js` module sends `PING\n` every 30s; Nucleo expects it
3. Nucleo controls a relay on the Pi's 5V rail
4. On missed pings: Nucleo logs fault, cuts power for 5s, restores

This will be wired into `agent.js` as `init_watchdog()` at boot once the STM32 firmware is written.

---

## Routine Maintenance

```bash
# Check status
bash /opt/african-village-node/scripts/status.sh

# Rotate logs older than 30 days
find /var/village/logs -name "*.log" -mtime +30 -delete

# Update agent
cd ~/african-village-node
git pull
sudo cp -r src /opt/african-village-node/
cd /opt/african-village-node && npm install --omit=dev
sudo systemctl restart village-node
```

---

_The African Village Cooperative — Node 001, Russell, Louisville KY_
_FCC License 0667-EX-CN-2026 — 530 MHz UHF TVWS_
