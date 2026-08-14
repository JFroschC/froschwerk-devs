@echo off
setlocal
title Froschwerk Agent Tools einrichten

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-froschwerk-agent.ps1"
if errorlevel 1 (
  echo.
  echo Das Setup konnte nicht gestartet werden.
  pause
)

endlocal
