@echo off
REM Project Dexter - Quick Start Script

echo.
echo Starting Project Dexter...
echo.

start "" npm start --silent

timeout /t 2 /nobreak >nul
exit
