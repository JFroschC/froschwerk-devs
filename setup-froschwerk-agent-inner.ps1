$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$env:CODEX_HOME = Join-Path $env:USERPROFILE ".codex"
$env:HOME = $env:USERPROFILE
$agentNpmBin = Join-Path $env:APPDATA "npm"
if (Test-Path -LiteralPath $agentNpmBin) { $env:PATH = "$agentNpmBin;$env:PATH" }
New-Item -ItemType Directory -Force -Path $env:CODEX_HOME, (Join-Path $env:CODEX_HOME "tmp"), (Join-Path $env:CODEX_HOME "tmp\arg0") | Out-Null

Write-Host "Installiere Codex CLI im Profil von $env:USERNAME ..." -ForegroundColor Cyan
& npm.cmd install --global @openai/codex
if ($LASTEXITCODE -ne 0) { throw "Codex CLI konnte nicht installiert werden." }

$env:PATH = "$(Join-Path $env:APPDATA 'npm');$env:PATH"
Write-Host ""
Write-Host "Codex CLI ist installiert. Jetzt mit deinem normalen ChatGPT-Konto anmelden:" -ForegroundColor Green
& codex.cmd login
if ($LASTEXITCODE -ne 0) { throw "Codex-Login wurde nicht erfolgreich abgeschlossen." }

Write-Host ""
Write-Host "Optional: Claude ebenfalls für FroschAgent installieren und anmelden:" -ForegroundColor Cyan
Write-Host "  npm.cmd install --global @anthropic-ai/claude-code"
Write-Host "  claude.exe"
Write-Host ""
Write-Host "Prüfe die vollständige Harness-Laufzeit ..." -ForegroundColor Cyan
& npm.cmd run harness:doctor
if ($LASTEXITCODE -ne 0) { throw "Der Harness-Laufzeitcheck ist fehlgeschlagen. Prüfe die obigen Hinweise." }
Write-Host ""
Write-Host "Setup beendet. Dieses Fenster kann offen bleiben oder geschlossen werden."
Read-Host "Enter zum Schließen"
