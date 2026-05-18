#!/usr/bin/env bash
# FinAnalyzer – Mac launcher
# Double-click this file in Finder to start the app.
# It will create a virtual environment on first run and install all dependencies.

set -euo pipefail

# Resolve the directory that contains this script (works even with symlinks)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/finanalyzer_py"
VENV_DIR="$APP_DIR/venv"

echo "====================================="
echo "  FinAnalyzer – Tally Audit Platform"
echo "====================================="
echo ""

# ── 1. Python check ───────────────────────────────────────────────────────────
PYTHON=""
for candidate in python3 python3.12 python3.11 python3.10 python3.9; do
    if command -v "$candidate" &>/dev/null; then
        PYTHON="$candidate"
        break
    fi
done

if [[ -z "$PYTHON" ]]; then
    osascript -e 'display alert "Python 3 not found" message "Please install Python 3.9 or later from https://python.org and try again." as critical'
    exit 1
fi

PYTHON_VERSION=$("$PYTHON" --version 2>&1 | awk '{print $2}')
echo "Using Python $PYTHON_VERSION  ($PYTHON)"

# ── 2. Create virtual environment if missing ──────────────────────────────────
if [[ ! -d "$VENV_DIR" ]]; then
    echo "Creating virtual environment at $VENV_DIR …"
    "$PYTHON" -m venv "$VENV_DIR"
    echo "Virtual environment created."
fi

# ── 3. Activate ───────────────────────────────────────────────────────────────
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
echo "Virtual environment activated."

# ── 4. Install / upgrade dependencies ─────────────────────────────────────────
echo "Checking dependencies…"
pip install --quiet --upgrade pip
pip install --quiet -r "$APP_DIR/requirements.txt"
echo "Dependencies OK."
echo ""

# ── 5. Launch app ─────────────────────────────────────────────────────────────
echo "Starting FinAnalyzer…"
cd "$APP_DIR"
python main.py
