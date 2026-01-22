@echo off
REM Launch Brave with remote debugging for Puppeteer MCP
REM This opens a separate profile so your main browsing is uninterrupted

set BRAVE_PATH=C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe
set DEBUG_PORT=9222

echo Launching Brave automation profile on port %DEBUG_PORT%...
echo You can continue using your main Brave normally.
echo.

REM Launch with a separate profile directory (will be created if doesn't exist)
"%BRAVE_PATH%" --remote-debugging-port=%DEBUG_PORT% --user-data-dir="%LOCALAPPDATA%\BraveAutomation"

echo.
echo Brave automation profile is now running.
echo Keep this window open or minimize it - Puppeteer will connect to it automatically.
echo Press Ctrl+C to close when done.
