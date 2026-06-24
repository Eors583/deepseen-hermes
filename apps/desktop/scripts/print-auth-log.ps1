param(
  [int]$Tail = 200
)

$logPath = Join-Path $env:LOCALAPPDATA 'hermes\logs\desktop.log'

if (-not (Test-Path -LiteralPath $logPath)) {
  Write-Error "desktop.log not found: $logPath"
  exit 1
}

Get-Content -LiteralPath $logPath -Tail $Tail |
  Select-String -Pattern '\[auth\]|\[renderer console\]|gateway ws|ws-ticket|login token|登录|Unauthorized|HTTP 401|HTTP 403'
