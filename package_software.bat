@echo off
setlocal
cd /d "%~dp0"

set "RELEASE_ROOT=%~dp0release"
set "PACKAGE_DIR=%RELEASE_ROOT%\FinAnalyzer_Release"
set "ZIP_FILE=%RELEASE_ROOT%\FinAnalyzer_Release.zip"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  pause
  exit /b 1
)

echo [1/4] Building app...
call npm run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo [2/4] Preparing release folder...
if exist "%PACKAGE_DIR%" rmdir /s /q "%PACKAGE_DIR%"
if not exist "%PACKAGE_DIR%" mkdir "%PACKAGE_DIR%"

echo [3/4] Copying files...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$src='%~dp0'; $dst='%PACKAGE_DIR%';" ^
  "$exclude=@('node_modules','release','.git');" ^
  "Get-ChildItem -LiteralPath $src -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object { Copy-Item $_.FullName -Destination $dst -Recurse -Force }"
if errorlevel 1 (
  echo Failed while copying project files.
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-ChildItem -LiteralPath '%PACKAGE_DIR%' -Directory -Recurse -Filter node_modules -ErrorAction SilentlyContinue | ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue };" ^
  "$remove=@('.env.local','vite-dev.log','vite-dev-check.log','vite-dev-check.err.log','27AACCF9909N1Z0_GSTR1_DEC-2025_11022026_165149.json','Fortiussampledatafor mis.csv');" ^
  "foreach($f in $remove){ $p=Join-Path '%PACKAGE_DIR%' $f; if(Test-Path $p){ Remove-Item $p -Force -ErrorAction SilentlyContinue } };" ^
  "$tmp=Join-Path '%PACKAGE_DIR%' '.tally-source-temp'; if(Test-Path $tmp){ Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }"

echo [4/4] Creating zip...
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '%ZIP_FILE%') { Remove-Item '%ZIP_FILE%' -Force }; Compress-Archive -Path '%PACKAGE_DIR%\*' -DestinationPath '%ZIP_FILE%' -Force"
if errorlevel 1 (
  echo Failed to create zip package.
  pause
  exit /b 1
)

echo.
echo Package created:
echo Folder: %PACKAGE_DIR%
echo Zip:    %ZIP_FILE%
echo.
echo Run guide file inside package: RUN_ME_FIRST.html
echo Desktop start file: run_tauri.bat
echo Desktop stop file:  close_tauri.bat
echo Browser fallback start: run_software.bat
echo Browser fallback stop:  close_software.bat
exit /b 0
