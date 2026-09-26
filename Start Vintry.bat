@echo off
rem Double-click this file on Windows to start Vintry.
title Vintry
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Vintry needs Node.js, a free program, to run on this computer.
  echo   Opening the Node.js download page. Install the LTS version, then double-click Start Vintry again.
  start "" "https://nodejs.org/en/download"
  echo.
  pause
  exit /b 1
)

for /f %%v in ('node -p "parseInt(process.versions.node)"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 20 (
  echo.
  echo   Vintry needs Node.js version 20 or newer. Opening the Node.js download page.
  start "" "https://nodejs.org/en/download"
  echo.
  pause
  exit /b 1
)

node scripts\launch.mjs
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
