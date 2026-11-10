@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Node.js 18+ is required. Install from https://nodejs.org/
 pause
 exit /b 1
)
echo.
echo MZANSI BEATS PC VIDEO SERVER
echo Videos in the connected library and subfolders are PUBLIC to website visitors.
echo Visitor uploads are stored separately in data\community-videos.
echo.
echo IMPORTANT: Select a different folder with CHOOSE-VIDEOS-FOLDER.bat if needed.
echo.
start "Mzansi Beats Server" cmd /k "node server.js"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"
endlocal
