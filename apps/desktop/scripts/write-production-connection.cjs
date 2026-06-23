const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'build')
const outPath = path.join(outDir, 'production-connection.json')

function firstEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] || '').trim()
    if (value) return value
  }
  return ''
}

function normalizeAuthMode(value) {
  if (value === 'oauth' || value === 'token') return value
  return 'jwt'
}

const url = firstEnv('HERBOUND_PROD_REMOTE_URL', 'HERMES_DESKTOP_PROD_REMOTE_URL', 'HERMES_DESKTOP_REMOTE_URL')
const authMode = normalizeAuthMode(
  firstEnv('HERBOUND_PROD_REMOTE_AUTH_MODE', 'HERMES_DESKTOP_PROD_REMOTE_AUTH_MODE', 'HERMES_DESKTOP_REMOTE_AUTH_MODE')
)
const token = firstEnv('HERBOUND_PROD_REMOTE_TOKEN', 'HERMES_DESKTOP_PROD_REMOTE_TOKEN', 'HERMES_DESKTOP_REMOTE_TOKEN')

fs.mkdirSync(outDir, { recursive: true })

if (!url) {
  fs.writeFileSync(
    outPath,
    `${JSON.stringify({ schemaVersion: 1, enabled: false, reason: 'HERBOUND_PROD_REMOTE_URL not set' }, null, 2)}\n`
  )
  console.log('[herbound-desktop] production connection disabled: HERBOUND_PROD_REMOTE_URL is not set')
  process.exit(0)
}

const body = {
  schemaVersion: 1,
  enabled: true,
  remote: {
    url,
    authMode,
    ...(authMode === 'token' && token ? { token: { encoding: 'plain', value: token } } : {})
  }
}

if (authMode === 'token' && !token) {
  throw new Error('HERBOUND_PROD_REMOTE_AUTH_MODE=token requires HERBOUND_PROD_REMOTE_TOKEN.')
}

fs.writeFileSync(outPath, `${JSON.stringify(body, null, 2)}\n`)
console.log(`[herbound-desktop] production connection: ${url} (${authMode})`)
