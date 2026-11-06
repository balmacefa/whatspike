#!/usr/bin/env bash
# Arranca el puente WhatsApp<->PC. Usa su PROPIO dispositivo (auth-bridge) y
# su propio store -> coexiste con el MCP de WhatsApp de pi, sin pelear creds.
# Vincular una sola vez: node bridge-login.mjs  (escanea el QR).
set -e
cd "$(dirname "$0")"
export PATH="/c/Program Files/nodejs:$PATH"
echo "[*] arrancando pike-bridge (dispositivo propio)..."
node pike-bridge.mjs
