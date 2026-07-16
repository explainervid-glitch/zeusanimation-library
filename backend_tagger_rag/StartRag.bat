@echo off
title RAG Server
echo ==========================================
echo Activate Virtual Environment (.venv)...
echo ==========================================

:: Activate venv (gunakan 'call' agar script tidak berhenti di sini)
call .venv\Scripts\activate.bat

echo ==========================================
echo Starting rag_server.py...
echo ==========================================

:: Menjalankan script python
python rag_server.py

:: Menjaga jendela tetap terbuka jika ada error atau setelah server berhenti
pause