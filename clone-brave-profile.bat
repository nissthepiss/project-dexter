@echo off
echo Cloning Brave profile...
echo This may take a few minutes depending on profile size...

robocopy "C:\Users\paulj\AppData\Local\BraveSoftware\Brave-Browser\User Data" "C:\Users\paulj\AppData\Local\BraveAutomation-Full" /E /R:0 /W:0 /NFL /NDL /NP

echo.
echo Clone complete!
echo Size:
dir "C:\Users\paulj\AppData\Local\BraveAutomation-Full" /s | find "bytes"
pause
