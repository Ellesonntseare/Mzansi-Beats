@echo off
setlocal
cd /d "%~dp0"
echo.
echo Choose a folder containing only videos you want to make PUBLIC.
echo Everyone with access to your Mzansi Beats website can stream videos in this folder and its subfolders.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0choose-videos-folder.ps1"
echo.
pause
endlocal
