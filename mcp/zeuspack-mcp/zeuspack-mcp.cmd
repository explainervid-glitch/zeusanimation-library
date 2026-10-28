@echo off
setlocal

:: ─── ZeusPack MCP launcher ───────────────────────────────────
:: Starts the MCP server from the latest deployed build, using zeuspack.exe
:: itself as the Node runtime — no Node install needed on team PCs.
:: deploy.mjs copies this file to W:\00 - ZEUSPACK\zeuspack-mcp.cmd.
::
:: stdout is the MCP protocol channel: nothing here may echo to it.
:: ─────────────────────────────────────────────────────────────

set "BASE=%~dp0"
set "LATEST_FILE=%BASE%latest.txt"

if not exist "%LATEST_FILE%" (
    echo [ZeusPack MCP] latest.txt not found in %BASE% 1>&2
    exit /b 1
)

set /p VERSION=<"%LATEST_FILE%"
for /f "tokens=* delims= " %%a in ("%VERSION%") do set VERSION=%%a

set "BUILD=%BASE%builds\%VERSION%"
set "SERVER=%BUILD%\resources\mcp\zeuspack-mcp.mjs"

if not exist "%SERVER%" (
    echo [ZeusPack MCP] Build v%VERSION% has no MCP server: %SERVER% 1>&2
    exit /b 1
)

set ELECTRON_RUN_AS_NODE=1
"%BUILD%\zeuspack.exe" "%SERVER%"
