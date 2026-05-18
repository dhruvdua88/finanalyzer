@echo off
:: FinAnalyzer – Windows launcher
:: Double-click this file to start the app.
:: Creates a virtual environment on first run and installs all dependencies.

setlocal EnableDelayedExpansion
title FinAnalyzer – Tally Audit Platform

echo =====================================
echo   FinAnalyzer - Tally Audit Platform
echo =====================================
echo.

:: ── Resolve paths ─────────────────────────────────────────────────────────────
set "SCRIPT_DIR=%~dp0"
:: Remove trailing backslash
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "APP_DIR=%SCRIPT_DIR%\finanalyzer_py"
set "VENV_DIR=%APP_DIR%\venv"

:: ── 1. Python check ───────────────────────────────────────────────────────────
set "PYTHON="
for %%P in (python python3 py) do (
    if "!PYTHON!"=="" (
        where %%P >nul 2>&1 && set "PYTHON=%%P"
    )
)

:: Try py launcher with version flags as fallback
if "!PYTHON!"=="" (
    py -3 --version >nul 2>&1 && set "PYTHON=py -3"
)

if "!PYTHON!"=="" (
    echo ERROR: Python 3 was not found on your system.
    echo Please install Python 3.9 or later from https://python.org
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%V in ('!PYTHON! --version 2^>^&1') do echo Using %%V

:: ── 2. Create virtual environment if missing ──────────────────────────────────
if not exist "%VENV_DIR%\Scripts\activate.bat" (
    echo Creating virtual environment at %VENV_DIR% ...
    !PYTHON! -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo Virtual environment created.
)

:: ── 3. Activate ───────────────────────────────────────────────────────────────
call "%VENV_DIR%\Scripts\activate.bat"
echo Virtual environment activated.

:: ── 4. Install / upgrade dependencies ─────────────────────────────────────────
echo Checking dependencies...
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r "%APP_DIR%\requirements.txt"
if errorlevel 1 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)
echo Dependencies OK.
echo.

:: ── 5. Launch app ─────────────────────────────────────────────────────────────
echo Starting FinAnalyzer...
cd /d "%APP_DIR%"
python main.py

:: Keep window open if app crashes so user can read error
if errorlevel 1 (
    echo.
    echo FinAnalyzer exited with an error. See above for details.
    pause
)
endlocal
