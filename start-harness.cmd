@echo off
setlocal
cd /d "%~dp0"
echo Starte Froschwerk Agent Harness...
echo Dieses Fenster offen lassen.
npm.cmd run start:harness
pause
