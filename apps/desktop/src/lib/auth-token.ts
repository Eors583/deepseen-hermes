const AUTH_TOKEN_KEY = 'herbound_auth_token'
export const AUTH_TOKEN_CHANGED_EVENT = 'herbound-auth-token-changed'

let inMemoryAuthToken: string | null = null

function authTokenGlobal(): { __HERBOUND_AUTH_TOKEN__?: string | null } {
  return globalThis as typeof globalThis & { __HERBOUND_AUTH_TOKEN__?: string | null }
}

export function getRuntimeAuthToken(): string | null {
  const token = inMemoryAuthToken || authTokenGlobal().__HERBOUND_AUTH_TOKEN__ || null

  return token && !isAuthTokenExpired(token) ? token : null
}

export function setRuntimeAuthToken(token: string | null): void {
  const normalized = token && token.trim() ? token.trim() : null
  inMemoryAuthToken = normalized
  authTokenGlobal().__HERBOUND_AUTH_TOKEN__ = normalized
}

interface JwtPayload {
  exp?: number
  id?: number | string
  sub?: number | string
  user_id?: number | string
}

function decodePayload(token: string): JwtPayload | null {
  try {
    const [, payload] = token.split('.')

    if (!payload) {
      return null
    }

    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')

    return JSON.parse(window.atob(padded)) as JwtPayload
  } catch {
    return null
  }
}

export function getStoredAuthToken(): string | null {
  const runtimeToken = getRuntimeAuthToken()

  if (runtimeToken) {
    console.info(`[auth] token read from runtime len=${runtimeToken.length}`)
    return runtimeToken
  }

  try {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY)

    if (token && !isAuthTokenExpired(token)) {
      inMemoryAuthToken = token
      authTokenGlobal().__HERBOUND_AUTH_TOKEN__ = token
      console.info(`[auth] token read from localStorage len=${token.length}`)

      return token
    }
  } catch {
    // Fall through to null; storage can be unavailable under restricted origins.
  }

  setRuntimeAuthToken(null)
  console.info('[auth] no valid stored token')

  return null
}

export function persistAuthToken(token: string | null) {
  let changed = true
  const normalized = token || null

  changed = getRuntimeAuthToken() !== normalized
  setRuntimeAuthToken(normalized)

  try {
    const previous = window.localStorage.getItem(AUTH_TOKEN_KEY)

    if (normalized) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, normalized)
      console.info(`[auth] token persisted len=${normalized.length}`)
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_KEY)
      console.info('[auth] token cleared')
    }

    changed = changed || previous !== normalized
  } catch {
    // Login state is best-effort in restricted storage contexts.
  }

  if (!changed) {
    return
  }

  try {
    window.dispatchEvent(new Event(AUTH_TOKEN_CHANGED_EVENT))
  } catch {
    // The renderer can run in tests or restricted contexts without events.
  }
}

export function clearAuthToken(): void {
  persistAuthToken(null)
}

export function isAuthTokenExpired(token: string, skewSeconds = 30): boolean {
  const payload = decodePayload(token)
  const exp = Number(payload?.exp || 0)

  if (!exp) {
    return true
  }

  return exp <= Math.floor(Date.now() / 1000) + skewSeconds
}

export function authTokenExpiresAt(token: string): number | null {
  const exp = Number(decodePayload(token)?.exp || 0)

  return exp ? exp * 1000 : null
}

export function getStoredAuthUserId(): string | null {
  const token = getStoredAuthToken()
  if (!token) {
    return null
  }

  const payload = decodePayload(token)
  const value = payload?.sub ?? payload?.user_id ?? payload?.id

  return value === undefined || value === null || value === '' ? null : String(value)
}
