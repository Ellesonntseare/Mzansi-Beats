@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 18+ from https://nodejs.org/ first.
 pause
 exit /b 1
)
node -e "const v=require('./video-folder'); const c=v.resolveVideoDirectory(process.cwd()),s=v.directoryStatus(c.dir); console.log('Windows server folder: '+c.dir); console.log('Configured by: '+c.source); console.log('Status: '+s.status); if(s.available){const fs=require('fs'); console.log('Folder can be read.');}else{console.log('Run CHOOSE-VIDEOS-FOLDER.bat to select the correct folder.'); process.exitCode=1;}"
echo.
pause
endlocal
