@echo off
setlocal
title Froschwerk Agent starten

echo Starte den Froschwerk-Harness unter dem eingeschraenkten Benutzer FroschAgent.
echo Windows fragt jetzt nach dem Passwort dieses Benutzers.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-froschwerk-agent.ps1"
if errorlevel 1 (
  echo.
  echo Der Agent konnte nicht gestartet werden.
  pause
)

endlocal
