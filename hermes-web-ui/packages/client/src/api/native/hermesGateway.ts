const REQUEST_TIMEOUT_MS = 120000
const STALE_DASHBOARD_TOKEN_RELOAD_KEY = 'hermes_stale_dashboard_token_reload_attempted'

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export interface GatewayEvent<T = Record<string, unknown>> {
  type: string
  session_id?: string
  payload?: T
  [key: string]: unknown
}

declare global {
  interface Window {
    __HERMES_SESSION_TOKEN__?: string
    __HERMES_AUTH_REQUIRED__?: boolean
    __HERMES_PASSWORD_AUTH__?: boolean
    __HERMES_BASE_PATH__?: string
  }
}

function basePath(): string {
  const base = window.__HERMES_BASE_PATH__ || ''
  if (!base) return ''
  return base.startsWith('/') ? base.replace(/\/+$/, '') : `/${base.replace(/\/+$/, '')}`
}

export function getDashboardToken(): string {
  return window.__HERMES_SESSION_TOKEN__ || ''
}

export async function getWsCredential(): Promise<[key: 'token' | 'ticket', value: string]> {
  if (window.__HERMES_AUTH_REQUIRED__ || window.__HERMES_PASSWORD_AUTH__) {
    const headers: Record<string, string> = {}
    if (window.__HERMES_PASSWORD_AUTH__) {
      const token = localStorage.getItem('hermes_api_key') || ''
      if (token) headers.Authorization = `Bearer ${token}`
    }
    const res = await fetch(`${basePath()}/api/auth/ws-ticket`, {
      method: 'POST',
      headers,
      credentials: 'include',
    })
    if (!res.ok) throw new Error(`/api/auth/ws-ticket: HTTP ${res.status}`)
    const data = await res.json() as { ticket?: string }
    if (!data.ticket) throw new Error('Hermes websocket ticket missing')
    return ['ticket', data.ticket]
  }
  const token = getDashboardToken()
  if (!token) throw new Error('Hermes dashboard token unavailable')
  return ['token', token]
}

export class HermesGatewayClient {
  private ws: WebSocket | null = null
  private reqId = 0
  private pending = new Map<string, PendingRequest>()
  private listeners = new Map<string, Set<(event: GatewayEvent) => void>>()

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  async connect(profile?: string | null): Promise<void> {
    if (this.connected) return
    const [key, value] = await getWsCredential()
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const qs = new URLSearchParams({ [key]: value })
    if (profile) qs.set('profile', profile)
    const ws = new WebSocket(`${proto}//${window.location.host}${basePath()}/api/ws?${qs.toString()}`)
    this.ws = ws
    ws.addEventListener('message', event => {
      try {
        this.dispatch(JSON.parse(event.data as string))
      } catch {
        // Ignore malformed frames from browser extensions/proxies.
      }
    })
    ws.addEventListener('close', () => {
      this.rejectAll(new Error('Hermes gateway websocket closed'))
    })
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.removeEventListener('error', onError)
        if (key === 'token') {
          try {
            sessionStorage.removeItem(STALE_DASHBOARD_TOKEN_RELOAD_KEY)
          } catch {
            // best-effort only
          }
        }
        resolve()
      }
      const onError = () => {
        ws.removeEventListener('open', onOpen)
        if (key === 'token') {
          try {
            if (!sessionStorage.getItem(STALE_DASHBOARD_TOKEN_RELOAD_KEY)) {
              sessionStorage.setItem(STALE_DASHBOARD_TOKEN_RELOAD_KEY, '1')
              window.location.reload()
              return
            }
          } catch {
            // Fall through to the normal error path when sessionStorage is unavailable.
          }
        }
        reject(new Error('Hermes gateway websocket failed'))
      }
      ws.addEventListener('open', onOpen, { once: true })
      ws.addEventListener('error', onError, { once: true })
    })
  }

  close(): void {
    this.ws?.close()
    this.ws = null
  }

  on(type: string, handler: (event: GatewayEvent) => void): () => void {
    let set = this.listeners.get(type)
    if (!set) {
      set = new Set()
      this.listeners.set(type, set)
    }
    set.add(handler)
    return () => set?.delete(handler)
  }

  async request<T>(method: string, params: Record<string, unknown> = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Hermes gateway is not connected')
    }
    const id = `hwui-${++this.reqId}`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject,
        timer,
      })
      this.ws?.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  private dispatch(message: any): void {
    if (message?.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      if (message.error) {
        pending.reject(new Error(message.error.message || 'Hermes gateway request failed'))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message?.method !== 'event') return
    const event = message.params as GatewayEvent
    if (!event?.type) return
    for (const handler of this.listeners.get(event.type) || []) handler(event)
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}
