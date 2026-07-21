@echo off
title LLM Server (Gemma)
echo ==========================================
echo Activate Virtual Environment (.venv)...
echo ==========================================

call .venv\Scripts\activate.bat

echo ==========================================
echo Starting llm_server.py...
echo ==========================================

python llm_server.py

pause
