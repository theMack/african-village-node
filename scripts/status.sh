#!/bin/bash
# African Village Node Agent — Status Check
# Run as: bash scripts/status.sh

echo "╔══════════════════════════════════════════╗"
echo "║   African Village Node Status             ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Service status ────────────────────────────────────────────────────────────
echo "── Service ──────────────────────────────────"
systemctl is-active village-node &>/dev/null \
  && echo "  village-node: RUNNING" \
  || echo "  village-node: STOPPED"
echo ""

# ── Network interfaces ────────────────────────────────────────────────────────
echo "── Network interfaces ───────────────────────"
for iface in wlan0 wlan1 bat0; do
  if ip link show $iface &>/dev/null; then
    STATUS=$(cat /sys/class/net/$iface/operstate 2>/dev/null || echo "unknown")
    IP=$(ip addr show $iface 2>/dev/null | grep 'inet ' | awk '{print $2}' || echo "no IP")
    echo "  $iface: $STATUS  $IP"
  else
    echo "  $iface: NOT FOUND"
  fi
done
echo ""

# ── Mesh peers ────────────────────────────────────────────────────────────────
echo "── Mesh peers (batman-adv) ──────────────────"
if command -v batctl &>/dev/null; then
  sudo batctl n 2>/dev/null || echo "  batctl unavailable"
else
  echo "  batctl not installed"
fi
echo ""

# ── TVWS interface ────────────────────────────────────────────────────────────
echo "── TVWS radio (wlan0) ───────────────────────"
iw wlan0 info 2>/dev/null | grep -E "type|channel|freq" || echo "  Interface not available"
echo ""

# ── Disk usage ────────────────────────────────────────────────────────────────
echo "── Cache ────────────────────────────────────"
if [ -d /opt/village-node/cache ]; then
  du -sh /opt/village-node/cache/* 2>/dev/null || echo "  Cache empty"
  echo "  Total: $(du -sh /opt/village-node/cache 2>/dev/null | cut -f1)"
else
  echo "  Cache directory not found"
fi
echo ""

# ── Recent logs ───────────────────────────────────────────────────────────────
echo "── Recent logs ──────────────────────────────"
journalctl -u village-node --no-pager -n 10 2>/dev/null || echo "  No logs available"
echo ""
