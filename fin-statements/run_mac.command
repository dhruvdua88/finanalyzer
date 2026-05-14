#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  Tally Financial Statements Generator — Mac Launcher
#  Double-click this file to install dependencies and open the app.
# ─────────────────────────────────────────────────────────────────────────────

# Move into the folder that contains this script
cd "$(dirname "$0")"

clear
echo "============================================================"
echo "  Tally Financial Statements Generator"
echo "  Schedule III Balance Sheet, P&L, 3-Year Projections"
echo "============================================================"
echo

# ── 1. Check Python 3 ────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "❌  Python 3 is not installed."
    echo
    echo "    Please download and install Python 3 from:"
    echo "    https://www.python.org/downloads/macos/"
    echo
    echo "    After installing, double-click this file again."
    echo
    open "https://www.python.org/downloads/macos/"
    read -r -p "Press Return to close..."
    exit 1
fi

PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "✅  Python $PY_VER found."
echo

# ── 2. Install / upgrade openpyxl ────────────────────────────────────────────
echo "📦  Installing required package (openpyxl)..."
python3 -m pip install --upgrade openpyxl --quiet 2>&1 | grep -v "^$"
if [ $? -ne 0 ]; then
    echo
    echo "⚠️   pip install failed. Trying with --user flag..."
    python3 -m pip install --upgrade openpyxl --user --quiet
fi
echo "✅  openpyxl ready."
echo

# ── 3. Launch the app ────────────────────────────────────────────────────────
echo "🚀  Opening Tally Financial Statements Generator..."
echo "    (Close this window at any time — the app will keep running)"
echo
python3 financial_statements.py

# Keep terminal open if the app crashes so the user can read the error
if [ $? -ne 0 ]; then
    echo
    echo "❌  The app exited with an error (see above)."
    read -r -p "Press Return to close..."
fi
