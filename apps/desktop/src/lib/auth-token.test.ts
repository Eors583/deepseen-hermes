import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getStoredAuthToken, isAuthTokenExpired, persistAuthToken } from './auth-token'

function jwt(exp: number): string {
  const encode = (value: unknown) =>
    window
      .btoa(JSON.stringify(value))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')

  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp })}.signature`
}

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
  persistAuthToken(null)
})

describe('auth token storage', () => {
  it('rejects expired tokens', () => {
    const token = jwt(Math.floor(Date.now() / 1000) - 10)

    persistAuthToken(token)

    expect(isAuthTokenExpired(token, 0)).toBe(true)
    expect(getStoredAuthToken()).toBeNull()
  })

  it('returns a stored live token', () => {
    const token = jwt(Math.floor(Date.now() / 1000) + 3600)

    persistAuthToken(token)

    expect(isAuthTokenExpired(token, 0)).toBe(false)
    expect(getStoredAuthToken()).toBe(token)
  })
})
