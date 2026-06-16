import router from '@/router'
import { getDashboardToken } from '@/api/native/hermesGateway'
import { normalizeProfileName } from '@/shared/profiles'

const DEFAULT_BASE_URL = ''

function isDesktopShell(): boolean {
  return typeof window !== 'undefined' &&
    (window as typeof window & { hermesDesktop?: { isDesktop?: boolean } }).hermesDesktop?.isDesktop === true
}

function getBaseUrl(): string {
  if (import.meta.env.VITE_HERMES_PREVIEW === '1') return DEFAULT_BASE_URL
  if (isDesktopShell()) return DEFAULT_BASE_URL
  return localStorage.getItem('hermes_server_url') || DEFAULT_BASE_URL
}

export function getApiKey(): string {
  const token = localStorage.getItem('hermes_api_key') || ''
  return token.split('.').length === 3 ? token : ''
}

export function setServerUrl(url: string) {
  localStorage.setItem('hermes_server_url', url)
}

export function setApiKey(key: string) {
  localStorage.setItem('hermes_api_key', key)
}

export function clearApiKey() {
  localStorage.removeItem('hermes_api_key')
}

export function hasApiKey(): boolean {
  return !!getApiKey()
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

function emptyUsageStats() {
  return {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_cache_read_tokens: 0,
    total_cache_write_tokens: 0,
    total_reasoning_tokens: 0,
    total_sessions: 0,
    total_cost: 0,
    total_api_calls: 0,
    period_days: 30,
    model_usage: [],
    daily_usage: [],
  }
}

async function nativeHermesResponse<T>(path: string, options: RequestInit): Promise<T | undefined> {
  const url = new URL(path, window.location.origin)
  const pathname = url.pathname
  const method = (options.method || 'GET').toUpperCase()

  if (pathname === '/health') {
    return {
      status: 'ok',
      platform: 'hermes',
      version: 'Herbound',
      gateway: 'native',
      webui_version: __APP_VERSION__,
      node_version: '23.0.0',
      agent_bridge: { status: 'ok', reachable: true, ready: true, running: true },
    } as T
  }

  if (pathname === '/api/hermes/profiles') {
    if (method === 'GET') {
      return {
        profiles: [{
          name: 'default',
          active: true,
          model: 'gpt-4o-mini',
          alias: 'Herbound',
          gatewayStatus: 'running',
          avatar: { type: 'generated', seed: 'Herbound' },
        }],
      } as T
    }
    return { success: true } as T
  }

  if (pathname === '/api/hermes/profiles/active') {
    return { success: true } as T
  }

  if (pathname.startsWith('/api/hermes/profiles/') && pathname.endsWith('/runtime-status')) {
    return {
      profile: 'default',
      bridge: { running: true, profile: 'default', reachable: true },
      gateway: { profile: 'default', running: true, host: window.location.hostname, url: window.location.origin },
    } as T
  }

  if (pathname === '/api/hermes/profiles/runtime-statuses') {
    return {
      profiles: [{
        profile: 'default',
        bridge: { running: true, profile: 'default', reachable: true },
        gateway: { profile: 'default', running: true, host: window.location.hostname, url: window.location.origin },
      }],
    } as T
  }

  if (pathname.startsWith('/api/hermes/profiles/')) {
    return {
      profile: {
        name: 'default',
        path: '.hermes',
        model: 'gpt-4o-mini',
        provider: 'custom',
        skills: 1,
        hasEnv: true,
        hasSoulMd: true,
        avatar: { type: 'generated', seed: 'Herbound' },
      },
    } as T
  }

  if (pathname === '/api/hermes/available-models') {
    const group = {
      provider: 'custom',
      label: 'Ominilink',
      base_url: 'https://api.ominilink.ai/v1',
      models: ['gpt-4o-mini'],
      available_models: ['gpt-4o-mini'],
      api_key: 'configured',
      api_mode: 'chat_completions',
      builtin: false,
    }
    return {
      default: 'gpt-4o-mini',
      default_provider: 'custom',
      groups: [group],
      allProviders: [group],
      profiles: [{
        profile: 'default',
        default: 'gpt-4o-mini',
        default_provider: 'custom',
        groups: [group],
      }],
      model_aliases: { custom: { 'gpt-4o-mini': 'Herbound 默认模型' } },
      model_visibility: {},
      custom_models: {},
    } as T
  }

  if (pathname === '/api/hermes/config/models') {
    return {
      default: 'gpt-4o-mini',
      groups: [{ provider: 'custom', models: [{ id: 'gpt-4o-mini', label: 'Herbound 默认模型' }] }],
    } as T
  }

  if (pathname === '/api/hermes/config') {
    return {
      display: {
        personality: 'herbound',
        streaming: true,
        final_response_markdown: 'raw',
        show_reasoning: false,
        bell_on_complete: false,
        notify_on_complete: false,
      },
      agent: {
        tool_use_enforcement: true,
      },
      skills: {},
      memory: { memory_enabled: false },
      compression: { enabled: false },
      approvals: { mode: 'off' },
    } as T
  }

  if (pathname === '/api/hermes/files/list') {
    return { entries: [], path: url.searchParams.get('path') || '', absolutePath: '' } as T
  }

  if (pathname === '/api/hermes/files/stat') {
    const filePath = url.searchParams.get('path') || ''
    return {
      name: filePath.split('/').filter(Boolean).pop() || '',
      path: filePath,
      absolutePath: filePath,
      isDir: true,
      size: 0,
      modTime: new Date().toISOString(),
      permissions: '',
    } as T
  }

  if (pathname === '/api/hermes/files/read') {
    const filePath = url.searchParams.get('path') || ''
    return { content: '', path: filePath, size: 0 } as T
  }

  if (pathname.startsWith('/api/hermes/files/')) {
    return { ok: true, files: [] } as T
  }

  if (pathname === '/api/hermes/usage/stats') return emptyUsageStats() as T
  if (pathname === '/api/hermes/sessions/usage') return {} as T
  if (pathname === '/api/hermes/sessions/context-length') return { context_length: 128000 } as T

  if (pathname === '/api/hermes/skills') {
    return { categories: [], sources: [], skills: [] } as T
  }
  if (pathname === '/api/hermes/memory') return { memories: [], profile: '' } as T
  if (pathname === '/api/hermes/jobs') return { jobs: [] } as T
  if (pathname === '/api/hermes/kanban') return { tasks: [], boards: [], stats: {} } as T

  return undefined
}

export type StoredUserRole = 'super_admin' | 'admin'

export function getStoredUserRole(): StoredUserRole | null {
  const token = getApiKey()
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const data = JSON.parse(atob(padded)) as { role?: unknown }
    return data.role === 'super_admin' || data.role === 'admin' ? data.role : null
  } catch {
    return null
  }
}

export function isStoredSuperAdmin(): boolean {
  return getStoredUserRole() === 'super_admin'
}

export function getStoredUsername(): string | null {
  const token = getApiKey()
  const payload = token.split('.')[1]
  if (!payload) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const data = JSON.parse(atob(padded)) as { username?: unknown }
    return typeof data.username === 'string' && data.username.length > 0 ? data.username : null
  } catch {
    return null
  }
}

export function getActiveProfileName(): string | null {
  const profile = localStorage.getItem('hermes_active_profile_name')
  return profile ? normalizeProfileName(profile) : profile
}

function bodyHasProfileSelector(body: BodyInit | null | undefined): boolean {
  if (typeof body !== 'string') return false
  try {
    const parsed = JSON.parse(body) as { profile?: unknown }
    return typeof parsed?.profile === 'string' && parsed.profile.trim().length > 0
  } catch {
    return false
  }
}

function shouldAttachProfileHeader(path: string, options: RequestInit): boolean {
  try {
    const url = new URL(path, 'http://hermes.local')
    if (url.searchParams.has('profile')) return false
    if (url.pathname.startsWith('/api/hermes/profiles')) return false
    if (isProfileWideSessionCollection(url.pathname)) return false
  } catch {
    if (path.startsWith('/api/hermes/profiles')) return false
    if (isProfileWideSessionCollection(path.split('?')[0] || path)) return false
  }
  return !bodyHasProfileSelector(options.body)
}

function isProfileWideSessionCollection(pathname: string): boolean {
  return pathname === '/api/hermes/sessions' ||
    pathname === '/api/hermes/sessions/batch-delete' ||
    pathname === '/api/hermes/search/sessions' ||
    pathname === '/api/hermes/sessions/search' ||
    pathname === '/api/hermes/sessions/conversations'
}

function emitAuthNotice(kind: 'expired' | 'forbidden') {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('hermes-auth-notice', { detail: { kind } }))
}

function messageFromErrorValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value !== 'object') return String(value)

  const record = value as Record<string, unknown>
  for (const key of ['message', 'error', 'detail', 'description']) {
    const message = messageFromErrorValue(record[key])
    if (message) return message
  }

  if (Array.isArray(value)) {
    return value.map(messageFromErrorValue).filter(Boolean).join('\n')
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function responseErrorMessage(text: string, statusText: string): string {
  const trimmed = text.trim()
  if (!trimmed) return statusText
  try {
    const parsed = JSON.parse(trimmed)
    return messageFromErrorValue(parsed) || trimmed
  } catch {
    return trimmed
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const native = await nativeHermesResponse<T>(path, options)
  if (native !== undefined) return native

  const base = getBaseUrl()
  const url = `${base}${path}`
  const isFormDataBody = typeof FormData !== 'undefined' && options.body instanceof FormData
  const headers: Record<string, string> = {
    ...(isFormDataBody ? {} : { 'Content-Type': 'application/json' }),
    ...options.headers as Record<string, string>,
  }

  const apiKey = getApiKey()
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  // Inject active profile header for request-scoped endpoints. Explicit profile
  // selectors in the URL/body and profile-name routes are validated directly.
  const profileName = getActiveProfileName()
  if (profileName && shouldAttachProfileHeader(path, options)) {
    headers['X-Hermes-Profile'] = profileName
  }

  const res = await fetch(url, { ...options, headers })

  // Global 401 handler — only redirect to login for local BFF endpoints
  // Proxied gateway requests should not trigger logout
  const isLocalBff = !path.startsWith('/api/hermes/v1/') &&
    !path.startsWith('/v1/')

  if (res.status === 401 && isLocalBff) {
    clearApiKey()
    emitAuthNotice('expired')
    if (router.currentRoute.value.name !== 'login') {
      router.replace({ name: 'login' })
    }
    throw new Error('Unauthorized')
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 403 && isLocalBff) {
      if (text.includes('User is disabled or does not exist')) {
        clearApiKey()
        emitAuthNotice('expired')
        if (router.currentRoute.value.name !== 'login') {
          router.replace({ name: 'login' })
        }
      } else {
        emitAuthNotice('forbidden')
      }
    }
    throw new Error(`API Error ${res.status}: ${responseErrorMessage(text, res.statusText)}`)
  }

  return res.json()
}

export function getBaseUrlValue(): string {
  return getBaseUrl()
}
