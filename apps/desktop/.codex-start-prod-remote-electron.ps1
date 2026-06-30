$env:HERMES_DESKTOP_REMOTE_URL = 'http://43.103.52.24:9119'
$env:HERMES_DESKTOP_REMOTE_AUTH_MODE = 'jwt'
$env:HERMES_DESKTOP_DEV_SERVER = 'http://127.0.0.1:5174'
$env:HERBOUND_DEEPSEEN_APP_API_URL = 'https://deepseen.ai/api'
$env:DEEPSEEN_APP_API_URL = 'https://deepseen.ai/api'
$env:NO_UPDATE_NOTIFIER = '1'
npm run --workspace apps/desktop dev:electron
