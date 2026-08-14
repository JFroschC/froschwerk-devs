$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot
$env:CODEX_HOME = Join-Path $env:USERPROFILE ".codex"
$env:HOME = $env:USERPROFILE
$agentNpmBin = Join-Path $env:APPDATA "npm"
if (Test-Path -LiteralPath $agentNpmBin) {
  $env:PATH = "$agentNpmBin;$env:PATH"
}
New-Item -ItemType Directory -Force -Path $env:CODEX_HOME, (Join-Path $env:CODEX_HOME "tmp"), (Join-Path $env:CODEX_HOME "tmp\arg0") | Out-Null

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js wurde für FroschAgent nicht gefunden." -ForegroundColor Red
  Write-Host "Installiere Node.js für alle Benutzer oder im Profil von FroschAgent."
  Read-Host "Enter zum Schließen"
  exit 1
}
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  Write-Host "npm.cmd wurde für FroschAgent nicht gefunden." -ForegroundColor Red
  Read-Host "Enter zum Schließen"
  exit 1
}

Write-Host "Workspace: $((Get-Location).Path)"
Write-Host "Benutzer: $([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)"
Write-Host "CODEX_HOME: $env:CODEX_HOME"
Write-Host ""

$probeWorkspace = $env:FROSCH_AGENT_WRITE_PROBE_WORKSPACE
if ([string]::IsNullOrWhiteSpace($probeWorkspace)) {
  $probeWorkspace = Read-Host "Projekt-Workspace für die Codex-Schreibprobe (Pfad eingeben; leer = Harness ohne Probe starten)"
}
if (-not [string]::IsNullOrWhiteSpace($probeWorkspace)) {
  try {
    $resolvedProbeWorkspace = (Resolve-Path -LiteralPath $probeWorkspace -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $resolvedProbeWorkspace -PathType Container)) { throw "Der angegebene Pfad ist kein Workspace-Ordner." }
    Write-Host "Prüfe Codex-Schreibrechte in: $resolvedProbeWorkspace" -ForegroundColor Cyan
    & npm.cmd run codex:verify-write -- --workspace $resolvedProbeWorkspace
    if ($LASTEXITCODE -ne 0) { throw "Die Codex-Schreibprobe ist fehlgeschlagen." }
    Write-Host "Schreibprobe erfolgreich; starte jetzt den Harness." -ForegroundColor Green
    Write-Host ""
  } catch {
    Write-Host "Harness wird nicht gestartet: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host "Enter zum Schließen"
    exit 1
  }
} else {
  Write-Host "Schreibprobe übersprungen. Setze FROSCH_AGENT_WRITE_PROBE_WORKSPACE für einen automatischen Lauf." -ForegroundColor Yellow
  Write-Host ""
}

Write-Host "Prüfe Harness, Datenbank, Workspaces, Git und Provider-Login ..." -ForegroundColor Cyan
& npm.cmd run harness:doctor
if ($LASTEXITCODE -ne 0) {
  Write-Host "Harness wird nicht gestartet: Der Laufzeitcheck ist fehlgeschlagen." -ForegroundColor Red
  Read-Host "Enter zum Schließen"
  exit 1
}
Write-Host "Laufzeitcheck erfolgreich." -ForegroundColor Green
Write-Host ""

& npm.cmd run dev
$exitCode = $LASTEXITCODE
Write-Host ""
Write-Host "Der Harness wurde beendet. Exit-Code: $exitCode"
Read-Host "Enter zum Schließen"
exit $exitCode
