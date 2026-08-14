@echo off
setlocal
title Froschwerk Agent Harness

cd /d "%~dp0"
set "CODEX_HOME=%USERPROFILE%\.codex"
set "HOME=%USERPROFILE%"
set "PATH=%APPDATA%\npm;%PATH%"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js wurde fuer FroschAgent nicht gefunden.
  echo Installiere Node.js fuer alle Benutzer oder im Profil von FroschAgent.
  pause
  exit /b 1
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo npm.cmd wurde fuer FroschAgent nicht gefunden.
  pause
  exit /b 1
)

echo Workspace: %CD%
echo CODEX_HOME: %CODEX_HOME%
echo.
call npm.cmd run harness:doctor
if errorlevel 1 (
  echo Harness-Laufzeitcheck fehlgeschlagen.
  pause
  exit /b 1
)

call npm.cmd run dev

echo.
echo Der Harness wurde beendet. Exit-Code: %ERRORLEVEL%
pause
endlocal
