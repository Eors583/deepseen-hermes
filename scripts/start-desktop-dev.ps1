$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

$env:HERMES_DATABASE_URL = "postgresql://hermes:change-me-before-prod@127.0.0.1:55432/hermes"
$env:DATABASE_URL = $env:HERMES_DATABASE_URL
$env:HERMES_HOME = Join-Path $repoRoot ".hermes"
$env:PYTHONPATH = $repoRoot

npm run --workspace apps/desktop dev
