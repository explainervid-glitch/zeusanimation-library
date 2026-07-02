@echo off
setlocal

:: ─── ZeusPack Launcher ────────────────────────────────────────
:: Reads latest.txt and launches the matching build.
:: Place this file at: W:\00 - ZEUSPACK\launcher.bat
:: ─────────────────────────────────────────────────────────────

set "BASE=%~dp0"
set "LATEST_FILE=%BASE%latest.txt"
set "BUILDS_DIR=%BASE%builds"

if not exist "%LATEST_FILE%" (
    echo [ZeusPack] ERROR: latest.txt not found.
    echo Please ask Development team to deploy first.
    pause
    exit /b 1
)

set /p VERSION=<"%LATEST_FILE%"
for /f "tokens=* delims= " %%a in ("%VERSION%") do set VERSION=%%a

set "EXE=%BUILDS_DIR%\%VERSION%\zeuspack.exe"

if not exist "%EXE%" (
    echo [ZeusPack] ERROR: Build v%VERSION% not found.
    echo Expected: %EXE%
    pause
    exit /b 1
)

echo [ZeusPack] Starting v%VERSION%...
start "" "%EXE%"
exit /b 0
