import type { HermesConnection } from '@/global'
import { getRuntimeAuthToken, getStoredAuthToken, persistAuthToken, setRuntimeAuthToken } from '@/lib/auth-token'

let gatewayAuthToken: string | null = null

export function setGatewayAuthToken(token: string | null): void {
  gatewayAuthToken = token && token.trim() ? token.trim() : null
  setRuntimeAuthToken(gatewayAuthToken)
  console.info(`[auth] gateway token ${gatewayAuthToken ? `set len=${gatewayAuthToken.length}` : 'cleared'}`)
}

/**
 * The desktop main process exposes `getGatewayWsUrl()` to re-mint a WebSocket
 * URL immediately before every `gateway.connect()`. For OAuth-gated remote
 * gateways the WS ticket is single-use with a ~30s TTL, so the ticket baked
 * into the cached `conn.wsUrl` is stale (and, after the first connect, already
 * consumed). For local/token gateways the URL carries a long-lived token and
 * never needs re-minting.
 *
 * Resolution rules:
 *
 * - OAuth: the fresh mint is the *only* viable URL. If it fails, do NOT fall
 *   back to `conn.wsUrl` — that ticket is dead and the connect is guaranteed to
 *   fail with an opaque "connection closed" error. Instead, let the mint error
 *   propagate so the caller can surface the gateway's reauth message
 *   ("session has expired… Sign in again").
 *
 * - token / local, or when the preload method is genuinely absent (older
 *   preload shapes): fall back to `conn.wsUrl`. The token URL is long-lived, so
 *   the fallback is safe and preserves compatibility.
 *
 * The error thrown for OAuth mint failures is tagged with `needsOauthLogin` so
 * callers can distinguish "the user must re-authenticate" from a generic
 * transport failure.
 */
export interface ResolveGatewayWsUrlDeps {
  /** `window.hermesDesktop.getGatewayWsUrl`, if the preload exposes it. The
   *  optional profile selects which backend to mint for — critical when swapping
   *  to a pooled profile, since the default mint resolves the primary backend. */
  getGatewayWsUrl?: (profile?: null | string, authToken?: string) => Promise<string>
}

export class GatewayReauthRequiredError extends Error {
  readonly needsOauthLogin = true

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'GatewayReauthRequiredError'
  }
}

export class GatewayLoginRequiredError extends Error {
  readonly needsLogin = true

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'GatewayLoginRequiredError'
  }
}

export function isGatewayReauthRequired(error: unknown): error is GatewayReauthRequiredError {
  return (
    error instanceof GatewayReauthRequiredError ||
    (typeof error === 'object' && error !== null && (error as { needsOauthLogin?: unknown }).needsOauthLogin === true)
  )
}

export function isGatewayLoginRequired(error: unknown): error is GatewayLoginRequiredError {
  return (
    error instanceof GatewayLoginRequiredError ||
    (typeof error === 'object' && error !== null && (error as { needsLogin?: unknown }).needsLogin === true)
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '')
}

function isAuthFailure(error: unknown): boolean {
  const statusCode = typeof error === 'object' && error !== null ? (error as { statusCode?: unknown }).statusCode : null
  if (statusCode === 401 || statusCode === 403) {
    return true
  }

  return /\b(?:401|403)\b/.test(errorMessage(error))
}

export async function resolveGatewayWsUrl(
  desktop: ResolveGatewayWsUrlDeps,
  conn: Pick<HermesConnection, 'authMode' | 'profile' | 'wsUrl'>
): Promise<string> {
  const mint = desktop.getGatewayWsUrl
  // Mint for THIS connection's profile, not the primary. Without it a pooled
  // profile swap re-mints the default backend's URL and connects to the wrong
  // backend.
  const profile = conn.profile ?? null

  if (conn.authMode === 'oauth') {
    if (!mint) {
      // OAuth gateway but no way to mint a fresh ticket: the cached ticket is
      // dead, so connecting with it cannot succeed. Surface a reauth error
      // rather than silently attempting a doomed connect.
      throw new GatewayReauthRequiredError(
        'Your remote gateway session needs to be refreshed. Open Settings → Gateway and click "Sign in" again.'
      )
    }

    try {
      return await mint(profile)
    } catch (error) {
      throw new GatewayReauthRequiredError(
        'Your remote gateway session has expired. Open Settings → Gateway and click "Sign in" again.',
        { cause: error }
      )
    }
  }

  if (conn.authMode === 'jwt') {
    if (!mint) {
      persistAuthToken(null)
      throw new GatewayLoginRequiredError('登录已过期，请重新登录。')
    }

    const authToken = gatewayAuthToken || getRuntimeAuthToken() || getStoredAuthToken()

    if (!authToken) {
      console.info('[auth] gateway ws ticket mint skipped: missing token')
      persistAuthToken(null)
      throw new GatewayLoginRequiredError('登录已过期，请重新登录。')
    }

    try {
      console.info(`[auth] minting gateway ws ticket token len=${authToken.length}`)
      return await mint(profile, authToken)
    } catch (error) {
      if (isAuthFailure(error)) {
        console.info(`[auth] gateway ws ticket auth failed: ${errorMessage(error)}`)
        persistAuthToken(null)
        throw new GatewayLoginRequiredError('登录已过期，请重新登录。', { cause: error })
      }

      console.info(`[auth] gateway ws ticket failed: ${errorMessage(error)}`)
      throw new Error(`无法获取线上对话连接票据：${errorMessage(error)}`)
    }
  }

  // token / local: the URL carries a long-lived token. Re-mint when available
  // (cheap, keeps parity), but the cached URL is a safe fallback.
  if (mint) {
    const fresh = await mint(profile).catch(() => null)

    if (fresh) {
      return fresh
    }
  }

  return conn.wsUrl
}
