import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type AuthUser, getCurrentAuthUser, loginUser } from '@/hermes'
import {
  AUTH_TOKEN_CHANGED_EVENT,
  authTokenExpiresAt,
  getStoredAuthToken,
  isAuthTokenExpired,
  persistAuthToken
} from '@/lib/auth-token'
import { setGatewayAuthToken } from '@/lib/gateway-ws-url'
import { LogOut } from '@/lib/icons'

interface AuthGateProps {
  children: ReactNode
}

type Status = 'checking' | 'ready' | 'unauthenticated'
const DEEPSEEN_REGISTER_URL = 'https://deepseen.ai/register'

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '')

  if (raw.includes('401')) {
    return '账号或密码不正确'
  }

  if (raw.includes('409')) {
    return '该用户名已存在'
  }

  if (raw.includes('429')) {
    return '尝试次数过多，请稍后再试'
  }

  return raw || '请求失败，请稍后重试'
}

function formatExpiry(token: string | null): string {
  if (!token) {
    return ''
  }

  const expiresAt = authTokenExpiresAt(token)

  if (!expiresAt) {
    return ''
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(expiresAt))
}

export function AuthGate({ children }: AuthGateProps) {
  const [status, setStatus] = useState<Status>('checking')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [token, setToken] = useState<string | null>(() => getStoredAuthToken())
  const [user, setUser] = useState<AuthUser | null>(null)

  const expiryLabel = useMemo(() => formatExpiry(token), [token])

  const logout = useCallback(() => {
    persistAuthToken(null)
    setGatewayAuthToken(null)
    setToken(null)
    setUser(null)
    setStatus('unauthenticated')
  }, [])

  const verify = useCallback(
    async (candidate: string | null = getStoredAuthToken()) => {
      if (!candidate || isAuthTokenExpired(candidate)) {
        logout()

        return
      }

      try {
        console.info(`[auth] verifying stored token len=${candidate.length}`)
        const result = await getCurrentAuthUser(candidate)

        setGatewayAuthToken(candidate)
        setUser(result.user)
        setToken(candidate)
        setStatus('ready')
        console.info(`[auth] token verified user=${result.user.username}`)
      } catch {
        console.info('[auth] stored token verification failed; logging out')
        logout()
      }
    },
    [logout]
  )

  useEffect(() => {
    void verify()
  }, [verify])

  useEffect(() => {
    const onTokenChanged = () => void verify()

    window.addEventListener(AUTH_TOKEN_CHANGED_EVENT, onTokenChanged)

    return () => window.removeEventListener(AUTH_TOKEN_CHANGED_EVENT, onTokenChanged)
  }, [verify])

  useEffect(() => {
    if (status !== 'ready') {
      return
    }

    const timer = window.setInterval(() => {
      const current = getStoredAuthToken()

      if (!current || isAuthTokenExpired(current)) {
        logout()
      }
    }, 60_000)

    return () => window.clearInterval(timer)
  }, [logout, status])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    const name = username.trim()

    if (!name || !password) {
      setError('请输入账号和密码')

      return
    }

    setBusy(true)

    try {
      console.info(`[auth] submitting login username=${name}`)
      const result = await loginUser(name, password)

      console.info(`[auth] login returned token=${result.token ? `yes len=${result.token.length}` : 'no'}`)
      setGatewayAuthToken(result.token)
      persistAuthToken(result.token)
      setToken(result.token)
      setPassword('')
      await verify(result.token)
    } catch (err) {
      console.info(`[auth] login failed: ${err instanceof Error ? err.message : String(err)}`)
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'checking') {
    return <PageLoader label="正在验证登录状态" />
  }

  if (status === 'ready' && user) {
    return (
      <>
        {children}
        <div className="fixed right-3 top-3 z-50 flex max-w-[min(22rem,calc(100vw-1.5rem))] items-center gap-2 rounded-md border border-border bg-card/95 px-2.5 py-2 text-xs text-foreground shadow-sm backdrop-blur">
          <span className="min-w-0 truncate text-muted-foreground" title={user.username}>
            {user.username}
          </span>
          <Button className="h-7 gap-1.5 px-2 text-xs" onClick={logout} title="退出登录" variant="outline">
            <LogOut className="size-3.5" />
            退出
          </Button>
        </div>
      </>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <section className="grid w-full max-w-[24rem] gap-6 rounded-xl border border-border bg-card px-6 py-7 shadow-sm">
        <div className="grid justify-items-center gap-3 text-center">
          <BrandMark className="size-12" />
          <div>
            <h1 className="text-xl font-semibold">登录 Herbound</h1>
            <p className="mt-1 text-sm text-muted-foreground">登录后继续使用智能体工作台</p>
          </div>
        </div>

        <form className="grid gap-3" onSubmit={event => void submit(event)}>
          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">账号</span>
            <Input
              autoComplete="username"
              autoFocus
              onChange={event => setUsername(event.target.value)}
              placeholder="请输入账号"
              value={username}
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="text-muted-foreground">密码</span>
            <Input
              autoComplete="current-password"
              onChange={event => setPassword(event.target.value)}
              placeholder="请输入密码"
              type="password"
              value={password}
            />
          </label>

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <Button className="mt-1 w-full" disabled={busy} type="submit">
            {busy ? '处理中...' : '登录'}
          </Button>
        </form>

        <div className="grid gap-2 text-center text-sm text-muted-foreground">
          <button
            className="text-primary hover:underline"
            onClick={() => {
              setError('')
              void window.hermesDesktop?.openExternal?.(DEEPSEEN_REGISTER_URL)
            }}
            type="button"
          >
            没有账号？去 DeepSeen 注册
          </button>
          <p>登录状态保留 7 天，过期后需要重新登录。</p>
          {expiryLabel && <p>当前登录有效期至 {expiryLabel}</p>}
        </div>
      </section>
    </main>
  )
}
