@echo off
title Server ZeusPack - AI Asset Tagger
echo ==========================================
echo Activate Virtual Environment (.venv)...
echo ==========================================

:: Activate venv (gunakan 'call' agar script tidak berhenti di sini)
call .venv\Scripts\activate.bat

echo ==========================================
echo Starting tagger_server.py...
echo ==========================================

:: Menjalankan script python
python tagger_server.py

:: Menjaga jendela tetap terbuka jika ada error atau setelah server berhenti
pause