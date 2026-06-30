import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { persistAuthToken } from './auth-token'
import {
  GatewayLoginRequiredError,
  GatewayReauthRequiredError,
  isGatewayLoginRequired,
  isGatewayReauthRequired,
  resolveGatewayWsUrl,
  setGatewayAuthToken
} from './gateway-ws-url'

const oauthConn = { authMode: 'oauth' as const, wsUrl: 'ws://host/api/ws?ticket=stale' }
const jwtConn = { authMode: 'jwt' as const, wsUrl: 'ws://host/api/ws?ticket=stale' }
const tokenConn = { authMode: 'token' as const, wsUrl: 'ws://host/api/ws?token=abc' }
const store = new Map<string, string>()

beforeEach(() => {
  store.clear()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      removeItem: (key: string) => {
        store.delete(key)
      },
      setItem: (key: string, value: string) => {
        store.set(key, value)
      }
    }
  })
})

afterEach(() => {
  setGatewayAuthToken(null)
  persistAuthToken(null)
})

function jwt(exp: number): string {
  const encode = (value: unknown) =>
    window
      .btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')

  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp })}.signature`
}

describe('resolveGatewayWsUrl', () => {
  describe('oauth mode', () => {
    it('uses the freshly minted URL', async () => {
      const getGatewayWsUrl = vi.fn().mockResolvedValue('ws://host/api/ws?ticket=fresh')
      await expect(resolveGatewayWsUrl({ getGatewayWsUrl }, oauthConn)).resolves.toBe('ws://host/api/ws?ticket=fresh')
      expect(getGatewayWsUrl).toHaveBeenCalledOnce()
    })

    it('throws a reauth error instead of falling back to the stale cached ticket', async () => {
      const getGatewayWsUrl = vi.fn().mockRejectedValue(new Error('401 cookie expired'))
      await expect(resolveGatewayWsUrl({ getGatewayWsUrl }, oauthConn)).rejects.toBeInstanceOf(
        GatewayReauthRequiredError
      )
    })

    it('preserves the underlying mint failure as the cause', async () => {
      const cause = new Error('401 cookie expired')
      const getGatewayWsUrl = vi.fn().mockRejectedValue(cause)
      const error = await resolveGatewayWsUrl({ getGatewayWsUrl }, oauthConn).catch(e => e)
      expect(error).toBeInstanceOf(GatewayReauthRequiredError)
      expect((error as GatewayReauthRequiredError).cause).toBe(cause)
    })

    it('throws a reauth error when the preload cannot mint (no method)', async () => {
      await expect(resolveGatewayWsUrl({}, oauthConn)).rejects.toBeInstanceOf(GatewayReauthRequiredError)
    })

    it('never returns the stale cached ticket on failure', async () => {
      const getGatewayWsUrl = vi.fn().mockRejectedValue(new Error('boom'))
      const result = await resolveGatewayWsUrl({ getGatewayWsUrl }, oauthConn).catch(() => 'threw')
      expect(result).toBe('threw')
      expect(result).not.toBe(oauthConn.wsUrl)
    })
  })

  describe('jwt mode', () => {
    it('mints with the stored Deepseen auth token', async () => {
      const token = jwt(Math.floor(Date.now() / 1000) + 3600)
      const getGatewayWsUrl = vi.fn().mockResolvedValue('ws://host/api/ws?ticket=fresh')

      persistAuthToken(token)

      await expect(resolveGatewayWsUrl({ getGatewayWsUrl }, jwtConn)).resolves.toBe('ws://host/api/ws?ticket=fresh')
      expect(getGatewayWsUrl).toHaveBeenCalledWith(null, token)
    })

    it('uses the explicitly synced auth token before storage', async () => {
      const token = jwt(Math.floor(Date.now() / 1000) + 3600)
      const getGatewayWsUrl = vi.fn().mockResolvedValue('ws://host/api/ws?ticket=fresh')

      setGatewayAuthToken(token)

      await expect(resolveGatewayWsUrl({ getGatewayWsUrl }, jwtConn)).resolves.toBe('ws://host/api/ws?ticket=fresh')
      expect(getGatewayWsUrl).toHaveBeenCalledWith(null, token)
    })

    it('uses the runtime global auth token when module state is reset', async () => {
      const token = jwt(Math.floor(Date.now() / 1000) + 3600)
      const getGatewayWsUrl = vi.fn().mockResolvedValue('ws://host/api/ws?ticket=fresh')

      setGatewayAuthToken(token)
      setGatewayAuthToken(null)
      ;(globalThis as typeof globalThis & { __HERBOUND_AUTH_TOKEN__?: string }).__HERBOUND_AUTH_TOKEN__ = token

      await expect(resolveGatewayWsUrl({ getGatewayWsUrl }, jwtConn)).resolves.toBe('ws://host/api/ws?ticket=fresh')
      expect(getGatewayWsUrl).toHaveBeenCalledWith(null, token)
    })

    it('requires login when the Deepseen auth token is missing', async () => {
      persistAuthToken(null)

      await expect(resolveGatewayWsUrl({ getGatewayWsUrl: vi.fn() }, jwtConn)).rejects.toBeInstanceOf(
        GatewayLoginRequiredError
      )
    })

    it('does not convert non-auth ticket failures into login expiry', async () => {
      const token = jwt(Math.floor(Date.now() / 1000) + 3600)
      const getGatewayWsUrl = vi.fn().mockRejectedValue(new Error('404: missing endpoint'))

      persistAuthToken(token)

      await expect(resolveGatewayWsUrl({ getGatewayWsUrl }, jwtConn)).rejects.toThrow(
        '无法获取线上对话连接票据：404: missing endpoint'
      )
    })

    it('requires login for an auth ticket failure', async () => {
      const token = jwt(Math.floor(Date.now() / 1000) + 3600)
      const error = new Error('401: Unauthorized') as Error & { statusCode?: number }
      error.statusCode = 401
      const getGatewayWsUrl = vi.fn().mockRejectedValue(error)

      persistAuthToken(token)

      await expect(resolveGatewayWsUrl({ getGatewayWsUrl }, jwtConn)).rejects.toBeInstanceOf(
        GatewayLoginRequiredError
      )
    })
  })

  describe('token / local mode', () => {
    it('uses the minted URL when available', async () => {
      const getGatewayWsUrl = vi.fn().mockResolvedValue('ws://host/api/ws?token=fresh')
      await expect(resolveGatewayWsUrl({ getGatewayWsUrl }, tokenConn)).resolves.toBe('ws://host/api/ws?token=fresh')
    })

    it('falls back to the cached URL when minting fails (token is long-lived)', async () => {
      const getGatewayWsUrl = vi.fn().mockRejectedValue(new Error('transient'))
      await expect(resolveGatewayWsUrl({ getGatewayWsUrl }, tokenConn)).resolves.toBe(tokenConn.wsUrl)
    })

    it('falls back to the cached URL when the preload method is absent', async () => {
      await expect(resolveGatewayWsUrl({}, tokenConn)).resolves.toBe(tokenConn.wsUrl)
    })

    it('treats a missing authMode as non-oauth (falls back safely)', async () => {
      await expect(resolveGatewayWsUrl({}, { wsUrl: tokenConn.wsUrl })).resolves.toBe(tokenConn.wsUrl)
    })
  })
})

describe('isGatewayReauthRequired', () => {
  it('detects the dedicated error class', () => {
    expect(isGatewayReauthRequired(new GatewayReauthRequiredError('x'))).toBe(true)
  })

  it('detects plain objects tagged with needsOauthLogin (from the main process)', () => {
    expect(isGatewayReauthRequired({ needsOauthLogin: true })).toBe(true)
  })

  it('rejects generic errors', () => {
    expect(isGatewayReauthRequired(new Error('connection closed'))).toBe(false)
    expect(isGatewayReauthRequired(null)).toBe(false)
    expect(isGatewayReauthRequired('string')).toBe(false)
  })
})

describe('isGatewayLoginRequired', () => {
  it('detects the dedicated login error class', () => {
    expect(isGatewayLoginRequired(new GatewayLoginRequiredError('x'))).toBe(true)
  })

  it('detects plain objects tagged with needsLogin', () => {
    expect(isGatewayLoginRequired({ needsLogin: true })).toBe(true)
  })

  it('rejects generic errors', () => {
    expect(isGatewayLoginRequired(new Error('connection closed'))).toBe(false)
    expect(isGatewayLoginRequired(null)).toBe(false)
  })
})
