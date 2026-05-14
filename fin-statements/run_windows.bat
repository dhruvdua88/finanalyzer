@echo off
setlocal EnableDelayedExpansion
title Tally Financial Statements Generator

cls
echo ============================================================
echo   Tally Financial Statements Generator
echo   Schedule III Balance Sheet, P&L, 3-Year Projections
echo ============================================================
echo.

REM ── 1. Check Python ──────────────────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo [X]  Python is not installed.
    echo.
    echo      Please download and install Python 3 from:
    echo      https://www.python.org/downloads/windows/
    echo.
    echo      IMPORTANT: Tick the box "Add Python to PATH" during installation.
    echo.
    echo      After installing, double-click this file again.
    echo.
    start https://www.python.org/downloads/windows/
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo [OK] %PY_VER% found.
echo.

REM ── 2. Install / upgrade openpyxl ────────────────────────────────────────────
echo [..] Installing required package (openpyxl)...
python -m pip install --upgrade openpyxl --quiet
if errorlevel 1 (
    echo [!!] pip install failed. Trying with --user flag...
    python -m pip install --upgrade openpyxl --user --quiet
    if errorlevel 1 (
        echo [X]  Could not install openpyxl. Check your internet connection.
        pause
        exit /b 1
    )
)
echo [OK] openpyxl ready.
echo.

REM ── 3. Launch the app ────────────────────────────────────────────────────────
echo [>>] Opening Tally Financial Statements Generator...
echo      (You can close this window once the app opens)
echo.

REM Change to the script's own directory so relative paths work
cd /d "%~dp0"
python financial_statements.py

REM Keep window open if app crashes so user can read the error
if errorlevel 1 (
    echo.
    echo [X]  The app exited with an error (see above).
    pause
)
