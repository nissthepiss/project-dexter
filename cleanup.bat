@echo off
echo Cleaning up unnecessary files...

REM Delete all .md files in root directory
del /Q "CHANNELS_IMPLEMENTATION_GUIDE.md" 2>nul
del /Q "CHANNELS_UI_UPDATE.md" 2>nul
del /Q "CRITICAL_PUBLIC_CHANNELS_FIX.md" 2>nul
del /Q "FINAL_SUMMARY.md" 2>nul
del /Q "HOLDER_PILL_GREEN_UPDATE.md" 2>nul
del /Q "IMPLEMENTATION_COMPLETE.md" 2>nul
del /Q "IMPLEMENTATION_COMPLETE_CHANNELS.md" 2>nul
del /Q "IMPLEMENTATION_SUMMARY.md" 2>nul
del /Q "INDEX.md" 2>nul
del /Q "INTEGRATION_GUIDE.md" 2>nul
del /Q "MASTER_CHECKLIST.md" 2>nul
del /Q "MVP_CALCULATOR_IMPROVEMENTS.md" 2>nul
del /Q "MVP_QUICK_INSTALL.md" 2>nul
del /Q "PUBLIC_CHANNELS_BUG_FIX.md" 2>nul
del /Q "PUBLIC_CHANNELS_CHECKBOX_COMPLETE.md" 2>nul
del /Q "PUBLIC_CHANNELS_FIX.md" 2>nul
del /Q "PUBLIC_CHANNELS_FIX_COMPLETE.md" 2>nul
del /Q "PUBLIC_CHANNELS_QUICKSTART.md" 2>nul
del /Q "PUBLIC_CHANNELS_QUICK_REF.md" 2>nul
del /Q "PUBLIC_CHANNELS_UPDATE.md" 2>nul
del /Q "QUICK_REFERENCE.md" 2>nul
del /Q "QUICK_VISUAL_REFERENCE.md" 2>nul
del /Q "RATE_LIMIT_UPDATE.md" 2>nul
del /Q "README_CHANGES.md" 2>nul
del /Q "README_TIER3.md" 2>nul
del /Q "SYSTEM_FLOW.md" 2>nul
del /Q "SYSTEM_FLOW_DIAGRAM.md" 2>nul
del /Q "TESTING_CHECKLIST.md" 2>nul
del /Q "TESTING_CHECKLIST_CHANNELS.md" 2>nul
del /Q "TIER3_QUEUE_UPDATE.md" 2>nul
del /Q "TIER3_UPDATE.txt" 2>nul
del /Q "UI_FIX_SUMMARY.md" 2>nul
del /Q "VISUAL_FLOW_DIAGRAM.md" 2>nul

REM Delete other unnecessary files
del /Q "New Bitmap image.bmp" 2>nul
del /Q "nul" 2>nul
del /Q "project dexter.rar" 2>nul
del /Q "Project Dexteros.rar" 2>nul

REM Delete .claude directory
rmdir /S /Q ".claude" 2>nul

echo Cleanup complete!
echo.
echo Deleted:
echo - All .md documentation files in root
echo - .bmp and nul files
echo - .rar archive files
echo - .claude directory
echo.
pause
