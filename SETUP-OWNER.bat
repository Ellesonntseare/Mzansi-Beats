@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (echo Install Node.js from https://nodejs.org/ & pause & exit /b 1)
echo Create the owner account BEFORE making your website public.
node setup-owner.js
pause
