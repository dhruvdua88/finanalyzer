#!/bin/zsh
# FinAnalyzer – React app launcher (macOS)
# Double-click in Finder to start the Vite dev server and open the app
# in your default browser. Installs npm dependencies on first run.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

APP_HOST="127.0.0.1"
APP_PORT="5173"
APP_URL="http://${APP_HOST}:${APP_PORT}"

echo "====================================="
echo "  FinAnalyzer – Tally Audit Platform"
echo "====================================="
echo ""

# ── 1. Node.js / npm check ────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "Node.js not found" message "Please install Node.js LTS (v18+) from https://nodejs.org and try again." as critical' 2>/dev/null || true
  echo "Node.js is not installed or not available in PATH."
  echo "Install Node.js LTS from https://nodejs.org and retry."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is not available in PATH. Reinstall Node.js LTS and retry."
  exit 1
fi

echo "Using $(node --version)  ($(command -v node))"

# ── 2. Free port 5173 if already in use ───────────────────────────────────────
PORT_PIDS="$(lsof -tiTCP:${APP_PORT} -sTCP:LISTEN 2>/dev/null || true)"
if [[ -n "$PORT_PIDS" ]]; then
  echo "Stopping existing process(es) on port ${APP_PORT}…"
  echo "$PORT_PIDS" | xargs kill 2>/dev/null || true
  sleep 1
  PORT_PIDS_REMAINING="$(lsof -tiTCP:${APP_PORT} -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$PORT_PIDS_REMAINING" ]]; then
    echo "$PORT_PIDS_REMAINING" | xargs kill -9 2>/dev/null || true
  fi
fi

# ── 3. Install dependencies if missing ────────────────────────────────────────
if [[ ! -d node_modules || ! -x node_modules/.bin/vite || ! -x node_modules/.bin/cross-env ]]; then
  echo "Installing app requirements (first run)…"
  npm install --no-audit --no-fund
fi

# ── 4. Open browser shortly after the server starts ───────────────────────────
( sleep 3 && open "${APP_URL}" >/dev/null 2>&1 ) &

# ── 5. Launch Vite dev server ─────────────────────────────────────────────────
echo "Starting FinAnalyzer at ${APP_URL}"
exec npm run dev -- --host "$APP_HOST" --port "$APP_PORT" --strictPort
