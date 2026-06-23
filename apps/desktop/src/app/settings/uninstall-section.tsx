import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { DesktopUninstallMode, DesktopUninstallSummary } from '@/global'
import { AlertTriangle, Loader2, Trash2 } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { SectionHeading } from './primitives'

interface ModeOption {
  mode: DesktopUninstallMode
  title: string
  description: string
  consequence: string
  needsAgent: boolean
}

const OPTIONS: ModeOption[] = [
  {
    mode: 'gui',
    title: '仅卸载桌面端',
    description: '只移除这个桌面应用，智能体、配置和对话记录都会保留。',
    consequence: '桌面端应用及其本地应用数据',
    needsAgent: false
  },
  {
    mode: 'lite',
    title: '卸载桌面端和智能体，保留数据',
    description: '移除桌面应用和 Herbound 智能体，但保留配置、对话和密钥，方便以后重新安装。',
    consequence: '桌面端和 Herbound 智能体，配置、对话和密钥会保留',
    needsAgent: true
  },
  {
    mode: 'full',
    title: '全部卸载',
    description: '移除桌面应用、智能体以及所有用户数据，包括配置、对话、定时任务、密钥和日志。',
    consequence: '全部内容：桌面端、Herbound 智能体、配置、对话、密钥和日志',
    needsAgent: true
  }
]

export function UninstallSection() {
  const [summary, setSummary] = useState<DesktopUninstallSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<DesktopUninstallMode | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const bridge = window.hermesDesktop?.uninstall

    if (!bridge) {
      setLoading(false)

      return
    }

    void bridge
      .summary()
      .then(result => {
        if (alive) {
          setSummary(result)
        }
      })
      .catch(() => {
        // Non-fatal: fall back to the desktop-only option.
      })
      .finally(() => {
        if (alive) {
          setLoading(false)
        }
      })

    return () => {
      alive = false
    }
  }, [])

  const bridge = window.hermesDesktop?.uninstall

  if (!bridge) {
    return null
  }

  const agentInstalled = summary?.agent_installed ?? false
  const visibleOptions = OPTIONS.filter(opt => agentInstalled || !opt.needsAgent)

  const handleConfirm = async () => {
    if (!pending) {
      return
    }

    setRunning(true)
    setError(null)

    try {
      const result = await bridge.run(pending)

      if (!result.ok) {
        setError(result.message || result.error || '卸载任务未能启动。')
        setRunning(false)
        setPending(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRunning(false)
      setPending(null)
    }
  }

  const pendingOption = OPTIONS.find(opt => opt.mode === pending) ?? null

  return (
    <div className="mx-auto mt-8 w-full max-w-2xl">
      <SectionHeading icon={AlertTriangle} title="危险操作" />

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            正在检查已安装内容...
          </div>
        ) : pendingOption ? (
          <div>
            <p className="text-sm font-medium text-destructive">确认卸载</p>
            <p className="mt-1 text-xs text-muted-foreground">
              这会移除{pendingOption.consequence}。此操作无法撤销。
            </p>
            {summary?.running_app_path && (
              <p className="mt-1 font-mono text-[0.68rem] text-muted-foreground/60">
                应用路径：{summary.running_app_path}
              </p>
            )}
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                disabled={running}
                onClick={() => void handleConfirm()}
                size="sm"
                variant="destructive"
              >
                {running && <Loader2 className="size-3 animate-spin" />}
                {running ? '正在卸载...' : '确认卸载'}
              </Button>
              <Button disabled={running} onClick={() => setPending(null)} size="sm" variant="text">
                取消
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">卸载 Herbound</p>
            <p className="text-xs text-muted-foreground">
              请选择要移除的范围。应用会关闭并完成卸载，后续可重新运行安装程序恢复使用。
            </p>
            <div className="mt-1 flex flex-col gap-2">
              {visibleOptions.map(opt => (
                <button
                  className={cn(
                    'flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 text-left transition',
                    'hover:border-destructive/40 hover:bg-destructive/5'
                  )}
                  key={opt.mode}
                  onClick={() => {
                    setError(null)
                    setPending(opt.mode)
                  }}
                  type="button"
                >
                  <Trash2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{opt.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{opt.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
