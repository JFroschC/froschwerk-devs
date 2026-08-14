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
$claudeAnswer = Read-Host "Auch Claude für FroschAgent einrichten und anmelden? (j/N)"
if ($claudeAnswer -match '^(j|ja|y|yes)$') {
  try {
    # Abo-Betrieb: Der ANTHROPIC_API_KEY muss leer sein, damit der Pro/Max-Login und nicht die API-Abrechnung greift.
    $env:ANTHROPIC_API_KEY = ""

    $claudeInstalled = $false
    try {
      & claude.exe --version *> $null
      if ($LASTEXITCODE -eq 0) { $claudeInstalled = $true }
    } catch { $claudeInstalled = $false }

    if (-not $claudeInstalled) {
      Write-Host "Installiere Claude Code CLI im Profil von $env:USERNAME ..." -ForegroundColor Cyan
      & npm.cmd install --global @anthropic-ai/claude-code
      if ($LASTEXITCODE -ne 0) { throw "Claude Code CLI konnte nicht installiert werden." }
    } else {
      Write-Host "Claude Code CLI ist bereits installiert." -ForegroundColor Green
    }

    $claudeLoggedIn = $false
    try {
      $claudeStatus = & claude.exe auth status --json 2> $null | ConvertFrom-Json
      if ($claudeStatus.loggedIn) { $claudeLoggedIn = $true }
    } catch { $claudeLoggedIn = $false }

    if ($claudeLoggedIn) {
      Write-Host "Claude ist bereits angemeldet." -ForegroundColor Green
    } else {
      Write-Host ""
      Write-Host "Melde dich jetzt mit deinem Claude Pro/Max-Abo an:" -ForegroundColor Green
      Write-Host "  1. Claude öffnet sich gleich. Tippe darin  /login  und bestätige im Browser." -ForegroundColor Green
      Write-Host "  2. Wähle NICHT 'Claude Console' (das wäre API-Abrechnung), sondern dein Abo." -ForegroundColor Yellow
      Write-Host "  3. Danach mit  /exit  zurück ins Setup." -ForegroundColor Green
      Write-Host ""
      & claude.exe
      try {
        $claudeStatus = & claude.exe auth status --json 2> $null | ConvertFrom-Json
        if ($claudeStatus.loggedIn) {
          Write-Host "Claude-Login erfolgreich." -ForegroundColor Green
        } else {
          Write-Host "Hinweis: Claude ist noch nicht angemeldet. Starte 'claude.exe' später erneut und führe /login aus." -ForegroundColor Yellow
        }
      } catch {
        Write-Host "Claude-Auth-Status konnte nicht geprüft werden. Prüfe später mit: npm.cmd run providers:check" -ForegroundColor Yellow
      }
    }
  } catch {
    Write-Host "Claude-Einrichtung übersprungen: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "Codex bleibt eingerichtet; du kannst Claude jederzeit nachziehen." -ForegroundColor Yellow
  }
} else {
  Write-Host "Claude wird übersprungen. Später nachziehbar mit:" -ForegroundColor DarkGray
  Write-Host "  npm.cmd install --global @anthropic-ai/claude-code" -ForegroundColor DarkGray
  Write-Host "  claude.exe   (darin /login, Abo statt Claude Console wählen)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Prüfe die vollständige Harness-Laufzeit ..." -ForegroundColor Cyan
& npm.cmd run harness:doctor
if ($LASTEXITCODE -ne 0) { throw "Der Harness-Laufzeitcheck ist fehlgeschlagen. Prüfe die obigen Hinweise." }
Write-Host ""
Write-Host "Setup beendet. Dieses Fenster kann offen bleiben oder geschlossen werden."
Read-Host "Enter zum Schließen"
