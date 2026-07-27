@echo off
REM ============================================================
REM  ZeusPack — start all three backends in one click
REM    Tagger : 8000   (Qwen2-VL, GPU)
REM    RAG    : 8001   (FastEmbed + Qdrant, CPU)
REM    LLM    : 8002   (Gemma or a cloud provider)
REM  Each opens its own window. Close a window (or Ctrl+C) to stop it.
REM  Control Center UI: http://localhost:8002/
REM ============================================================

cd /d "%~dp0"
title ZeusPack - Launcher

REM ---- Models start IDLE (no VRAM used) ----------------------
REM  Both servers boot without loading anything into VRAM. A model is
REM  pulled in on first use, or when you press Load / "Switch to..."
REM  in the Control Center.
REM  Uncomment a line below to load that model up front instead:
REM set TAGGER_PRELOAD=1
REM set LLM_PRELOAD=1

echo.
echo  Starting ZeusPack backends...
echo.

echo  [1/3] Tagger  : 8000
start "ZeusPack Tagger (8000)" cmd /k StartTag.bat
timeout /t 3 /nobreak >nul

echo  [2/3] RAG     : 8001
start "ZeusPack RAG (8001)" cmd /k StartRag.bat
timeout /t 3 /nobreak >nul

echo  [3/3] LLM     : 8002
start "ZeusPack LLM (8002)" cmd /k StartLLM.bat

echo.
echo  Waiting for the servers to come up...
timeout /t 8 /nobreak >nul

echo  Opening Control Center...
start "" http://localhost:8002/

echo.
echo  Done. Three server windows are now running.
echo  Control Center: http://localhost:8002/
echo.
echo  (Models can take a minute to load - the UI will show
echo   "idle" until they are ready.)
echo.
pause
