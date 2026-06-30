import { useEffect, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { type AuthUser, getCurrentAuthUser } from '@/hermes'
import { authTokenExpiresAt, clearAuthToken, getStoredAuthToken } from '@/lib/auth-token'
import { setGatewayAuthToken } from '@/lib/gateway-ws-url'
import { LogOut } from '@/lib/icons'

function expiryLabel(token: string | null): string {
  if (!token) return ''
  const expiresAt = authTokenExpiresAt(token)
  if (!expiresAt) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(expiresAt))
}

export function AccountSettings() {
  const [token, setToken] = useState<string | null>(() => getStoredAuthToken())
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const validUntil = useMemo(() => expiryLabel(token), [token])

  useEffect(() => {
    let cancelled = false
    const current = getStoredAuthToken()
    setToken(current)

    async function load() {
      if (!current) {
        setLoading(false)
        return
      }
      try {
        const result = await getCurrentAuthUser(current)
        if (!cancelled) setUser(result.user)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [])

  const signOut = () => {
    clearAuthToken()
    setGatewayAuthToken(null)
    setToken(null)
    setUser(null)
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-6 pb-8">
      <div>
        <h2 className="text-lg font-semibold">账号</h2>
        <p className="mt-1 text-sm text-muted-foreground">管理当前 Deepseen 登录状态。</p>
      </div>

      <section className="grid gap-4 rounded-lg border border-border bg-card p-4">
        <div className="grid gap-1.5">
          <div className="text-sm text-muted-foreground">当前账号</div>
          <div className="text-base font-medium">{loading ? '正在读取...' : user?.username || '未登录'}</div>
          {validUntil && <div className="text-xs text-muted-foreground">登录有效期至 {validUntil}</div>}
        </div>

        <div className="flex justify-start">
          <Button className="gap-2" disabled={!token} onClick={signOut} variant="outline">
            <LogOut className="size-4" />
            退出登录
          </Button>
        </div>
      </section>
    </div>
  )
}
