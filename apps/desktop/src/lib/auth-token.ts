const AUTH_TOKEN_KEY = 'herbound_auth_token'

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
  try {
    const token = window.localStorage.getItem(AUTH_TOKEN_KEY)

    return token && !isAuthTokenExpired(token) ? token : null
  } catch {
    return null
  }
}

export function persistAuthToken(token: string | null) {
  try {
    if (token) {
      window.localStorage.setItem(AUTH_TOKEN_KEY, token)
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_KEY)
    }
  } catch {
    // Login state is best-effort in restricted storage contexts.
  }
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
