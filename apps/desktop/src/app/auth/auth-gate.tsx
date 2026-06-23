import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

import { BrandMark } from '@/components/brand-mark'
import { PageLoader } from '@/components/page-loader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { type AuthUser, getCurrentAuthUser, loginUser, registerUser } from '@/hermes'
import { authTokenExpiresAt, getStoredAuthToken, isAuthTokenExpired, persistAuthToken } from '@/lib/auth-token'

interface AuthGateProps {
  children: ReactNode
}

type Mode = 'login' | 'register'
type Status = 'checking' | 'ready' | 'unauthenticated'

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
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [token, setToken] = useState<string | null>(() => getStoredAuthToken())
  const [user, setUser] = useState<AuthUser | null>(null)

  const expiryLabel = useMemo(() => formatExpiry(token), [token])

  const logout = useCallback(() => {
    persistAuthToken(null)
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
        const result = await getCurrentAuthUser(candidate)

        setUser(result.user)
        setToken(candidate)
        setStatus('ready')
      } catch {
        logout()
      }
    },
    [logout]
  )

  useEffect(() => {
    void verify()
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

    if (mode === 'register' && password !== confirmPassword) {
      setError('两次输入的密码不一致')

      return
    }

    setBusy(true)

    try {
      const result = mode === 'login' ? await loginUser(name, password) : await registerUser(name, password)

      persistAuthToken(result.token)
      setToken(result.token)
      setPassword('')
      setConfirmPassword('')
      await verify(result.token)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  if (status === 'checking') {
    return <PageLoader label="正在验证登录状态" />
  }

  if (status === 'ready' && user) {
    return <>{children}</>
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10 text-foreground">
      <section className="grid w-full max-w-[24rem] gap-6 rounded-xl border border-border bg-card px-6 py-7 shadow-sm">
        <div className="grid justify-items-center gap-3 text-center">
          <BrandMark className="size-12" />
          <div>
            <h1 className="text-xl font-semibold">登录 Herbound</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === 'login' ? '登录后继续使用智能体工作台' : '创建账号后即可进入工作台'}
            </p>
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
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={event => setPassword(event.target.value)}
              placeholder="请输入密码"
              type="password"
              value={password}
            />
          </label>

          {mode === 'register' && (
            <label className="grid gap-1.5 text-sm">
              <span className="text-muted-foreground">确认密码</span>
              <Input
                autoComplete="new-password"
                onChange={event => setConfirmPassword(event.target.value)}
                placeholder="请再次输入密码"
                type="password"
                value={confirmPassword}
              />
            </label>
          )}

          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

          <Button className="mt-1 w-full" disabled={busy} type="submit">
            {busy ? '处理中...' : mode === 'login' ? '登录' : '注册并登录'}
          </Button>
        </form>

        <div className="grid gap-2 text-center text-sm text-muted-foreground">
          <button
            className="text-primary hover:underline"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError('')
            }}
            type="button"
          >
            {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
          </button>
          <p>登录状态保留 7 天，过期后需要重新登录。</p>
          {expiryLabel && <p>当前登录有效期至 {expiryLabel}</p>}
        </div>
      </section>
    </main>
  )
}
