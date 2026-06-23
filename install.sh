#!/bin/bash
# African Village Node Agent — Installation Script
# Run as: sudo bash scripts/install.sh
# Tested on: Raspberry Pi OS Lite 64-bit (Debian Bookworm)

set -e

INSTALL_DIR=/opt/village-node
SERVICE_NAME=village-node
NODE_MIN_VERSION=18

echo "╔══════════════════════════════════════════╗"
echo "║   African Village Node Agent Installer    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Check running as root ─────────────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
  echo "ERROR: Run as root (sudo bash scripts/install.sh)"
  exit 1
fi

# ── System update ─────────────────────────────────────────────────────────────
echo "→ Updating system packages..."
apt update -qq
apt upgrade -y -qq

# ── Install dependencies ──────────────────────────────────────────────────────
echo "→ Installing system dependencies..."
apt install -y -qq \
  git \
  curl \
  iw \
  wireless-tools \
  batman-adv-dkms \
  rfkill

# ── Install Node.js ───────────────────────────────────────────────────────────
echo "→ Checking Node.js..."
if command -v node &> /dev/null; then
  NODE_VERSION=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
  if [ "$NODE_VERSION" -lt "$NODE_MIN_VERSION" ]; then
    echo "→ Node.js ${NODE_VERSION} found — upgrading to 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
  else
    echo "→ Node.js ${NODE_VERSION} found — OK"
  fi
else
  echo "→ Installing Node.js 20.x..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs
fi

# ── Create install directory ──────────────────────────────────────────────────
echo "→ Setting up ${INSTALL_DIR}..."
mkdir -p $INSTALL_DIR
mkdir -p $INSTALL_DIR/cache/live
mkdir -p $INSTALL_DIR/cache/archive

# ── Clone or update repo ──────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "→ Updating existing installation..."
  cd $INSTALL_DIR
  git pull origin main
else
  echo "→ Cloning african-village-node..."
  git clone https://github.com/theMack/african-village-node.git $INSTALL_DIR
  cd $INSTALL_DIR
fi

# ── Install Node dependencies ─────────────────────────────────────────────────
echo "→ Installing Node.js dependencies..."
cd $INSTALL_DIR
npm install --production

# ── Configure environment ─────────────────────────────────────────────────────
if [ ! -f "$INSTALL_DIR/.env" ]; then
  echo "→ Creating .env from template..."
  cp $INSTALL_DIR/.env.example $INSTALL_DIR/.env
  echo ""
  echo "⚠️  IMPORTANT: Edit ${INSTALL_DIR}/.env before starting the service"
  echo "   Required: NODE_ID, NODE_NAME, LATITUDE, LONGITUDE, SUPABASE_ANON_KEY"
  echo ""
fi

# ── Set permissions ───────────────────────────────────────────────────────────
echo "→ Setting permissions..."
chown -R pi:pi $INSTALL_DIR
chmod 600 $INSTALL_DIR/.env

# ── Load batman-adv on boot ───────────────────────────────────────────────────
echo "→ Configuring batman-adv autoload..."
if ! grep -q "batman-adv" /etc/modules; then
  echo "batman-adv" >> /etc/modules
fi

# ── Install systemd service ───────────────────────────────────────────────────
echo "→ Installing systemd service..."
cp $INSTALL_DIR/systemd/village-node.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable $SERVICE_NAME

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Installation complete                   ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Edit /opt/village-node/.env with your node configuration"
echo "  2. Start the service: sudo systemctl start village-node"
echo "  3. View logs: sudo journalctl -u village-node -f"
echo ""
