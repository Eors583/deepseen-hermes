param(
  [string]$PostgresPassword = "HerboundPg_2026_prod",
  [string]$PostgresBind = "127.0.0.1",
  [string]$PostgresPort = "5432",
  [string]$DatabaseUrl = "",
  [string]$WebBind = "0.0.0.0",
  [string]$WebPort = "9119"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$localEnvPath = Join-Path $repoRoot ".hermes\.env"
$prodEnvPath = Join-Path $repoRoot ".env.prod"

if (-not (Test-Path $localEnvPath)) {
  throw "Project-local Hermes env not found: $localEnvPath"
}

$local = @{}
foreach ($line in Get-Content $localEnvPath) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
    continue
  }
  $idx = $trimmed.IndexOf("=")
  $key = $trimmed.Substring(0, $idx).Trim()
  $value = $trimmed.Substring($idx + 1).Trim()
  if ($key) {
    $local[$key] = $value
  }
}

function EnvValue([string]$key, [string]$fallback = "") {
  if ($local.ContainsKey($key)) {
    return [string]$local[$key]
  }
  return $fallback
}

$resolvedDatabaseUrl = if ($DatabaseUrl) {
  $DatabaseUrl
} else {
  EnvValue 'HERMES_DATABASE_URL' "postgresql://hermes:$PostgresPassword@postgres:5432/hermes"
}

$lines = @(
  "HERMES_WEB_BIND=$WebBind",
  "HERMES_WEB_PORT=$WebPort",
  "",
  "HERBOUND_AUTH_PROVIDER=deepseen",
  "",
  "POSTGRES_DB=hermes",
  "POSTGRES_USER=hermes",
  "POSTGRES_PASSWORD=$PostgresPassword",
  "POSTGRES_BIND=$PostgresBind",
  "POSTGRES_PORT=$PostgresPort",
  "",
  "HERMES_DATABASE_URL=$resolvedDatabaseUrl",
  "DATABASE_URL=$resolvedDatabaseUrl",
  "",
  "DEEPSEEN_BASE_URL=$(EnvValue 'DEEPSEEN_BASE_URL' 'https://deepseen.ai/v1')",
  "",
  "AIG_AI_API_KEY=$(EnvValue 'AIG_AI_API_KEY')",
  "OMINILINK_API_KEY=$(EnvValue 'OMINILINK_API_KEY')",
  "KIE_API_KEY=$(EnvValue 'KIE_API_KEY')",
  "OPENAI_API_KEY=$(EnvValue 'OPENAI_API_KEY')",
  "CUSTOM_API_KEY=$(EnvValue 'CUSTOM_API_KEY')",
  "GOOGLE_AI_API_KEY=$(EnvValue 'GOOGLE_AI_API_KEY')",
  "GOOGLE_API_KEY=$(EnvValue 'GOOGLE_API_KEY')",
  "GEMINI_API_KEY=$(EnvValue 'GEMINI_API_KEY')",
  "KIE_BASE_URL=$(EnvValue 'KIE_BASE_URL' 'https://api.kie.ai')",
  "GOOGLE_AI_BASE_URL=$(EnvValue 'GOOGLE_AI_BASE_URL' 'https://api.ominilink.ai')",
  "OPENAI_BASE_URL=$(EnvValue 'OPENAI_BASE_URL' 'https://api.ominilink.ai/v1')",
  "CUSTOM_BASE_URL=$(EnvValue 'CUSTOM_BASE_URL' 'https://api.ominilink.ai/v1')",
  "GEMINI_BASE_URL=$(EnvValue 'GEMINI_BASE_URL' 'https://api.ominilink.ai')"
)

[System.IO.File]::WriteAllText($prodEnvPath, ($lines -join [Environment]::NewLine) + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

Write-Host "Wrote $prodEnvPath"
Write-Host "PostgreSQL URL: $resolvedDatabaseUrl"
