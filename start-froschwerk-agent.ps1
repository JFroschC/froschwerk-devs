$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$userName = "$env:COMPUTERNAME\FroschAgent"

try {
  $credential = Get-Credential -UserName $userName -Message "Passwort für FroschAgent eingeben"
  if ($null -eq $credential) { exit 1 }

  $inner = Join-Path $root "run-froschwerk-agent-inner.ps1"
  $innerArgument = '"' + $inner + '"'
  Start-Process -FilePath "powershell.exe" `
    -Credential $credential `
    -LoadUserProfile `
    -WorkingDirectory $root `
    -WindowStyle Normal `
    -ArgumentList @("-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $innerArgument) | Out-Null
} catch {
  Write-Host "Start fehlgeschlagen: $($_.Exception.Message)" -ForegroundColor Red
  Read-Host "Enter zum Schließen"
  exit 1
}
