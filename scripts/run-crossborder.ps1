$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$env:HERMES_HOME = Join-Path $Root ".hermes"
$env:PYTHONPATH = "$Root;$env:PYTHONPATH"

python -m hermes_cli.main @args
