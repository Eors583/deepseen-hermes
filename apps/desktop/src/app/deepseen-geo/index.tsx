import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { deepseenRequest } from '@/hermes'
import { cn } from '@/lib/utils'

type GeoTab = 'diagnose' | 'monitor' | 'optimize'
type GeoTarget = 'copy' | 'faq' | 'structuredData' | 'tiktokCaption'

interface GeoDimension {
  evidence?: string[]
  key?: string
  label?: string
  recommendation?: string
  score?: number
  status?: 'fail' | 'pass' | 'warn' | string
}

interface GeoSignal {
  evidence?: string
  key?: string
  label?: string
  recommendation?: string
  status?: 'fail' | 'pass' | 'warn' | string
}

interface GeoDiagnosisReport {
  dimensions?: GeoDimension[]
  extracted?: {
    crawlWarning?: string
    productName?: string
  }
  limitations?: string[]
  quickWins?: string[]
  score?: number
  signals?: GeoSignal[]
  summary?: string
  url?: string
}

interface GeoOptimizationDraft {
  checklist?: Array<{ action?: string; output?: string; priority?: 'high' | 'low' | 'medium' | string; step?: number; title?: string }>
  faq?: Array<{ answer?: string; question?: string }>
  jsonLd?: unknown
  meta?: {
    description?: string
    title?: string
  }
  pageCopy?: {
    heroTitle?: string
    productIntro?: string
    useCases?: string[]
  }
  tiktokSuggestions?: {
    bioLine?: string
    caption?: string
    pinnedComment?: string
  }
}

interface GeoMonitorResult {
  answerChecks?: Array<{
    citedTarget?: boolean
    evidence?: string
    mentioned?: boolean
    prompt?: string
    provider?: string
  }>
  suggestedPrompts?: string[]
  summary?: {
    checkedAnswers?: number
    citationRate?: number
    mentionRate?: number
    nextAction?: string
  }
}

interface GeoFormState {
  productName: string
  targetMarket: string
  url: string
}

const TARGET_OPTIONS: Array<{ label: string; value: GeoTarget }> = [
  { label: 'FAQ', value: 'faq' },
  { label: '页面文案', value: 'copy' },
  { label: '结构化数据', value: 'structuredData' },
  { label: 'TikTok 文案', value: 'tiktokCaption' }
]

const TAB_COPY: Record<GeoTab, { button: string; description: string; icon: string; title: string }> = {
  diagnose: {
    button: '开始诊断',
    description: '检查 TikTok 或独立站链接是否容易被 AI 搜索理解、总结和引用。',
    icon: 'checklist',
    title: 'GEO诊断'
  },
  monitor: {
    button: '检查样本',
    description: '生成监控问题，并检查手动采样的 AI 回答是否提及品牌/产品或引用目标链接。',
    icon: 'pulse',
    title: 'GEO监控'
  },
  optimize: {
    button: '生成优化草稿',
    description: '基于链接和诊断结果生成 FAQ、页面文案、Meta 信息、结构化数据和 TikTok 承接建议。',
    icon: 'sparkle',
    title: 'GEO优化'
  }
}

const DEFAULT_FORM: GeoFormState = {
  productName: '',
  targetMarket: 'US',
  url: ''
}

function parseMonitorAnswers(raw: string) {
  return raw
    .split(/\n{2,}/)
    .map(text => text.trim())
    .filter(Boolean)
    .map((answerText, index) => ({
      answerText,
      citedUrls: answerText.match(/https?:\/\/[^\s)]+/g) || [],
      prompt: 'Manual GEO sample',
      provider: `Sample ${index + 1}`
    }))
}

function sourceLabel(url: string): string {
  const text = url.trim().toLowerCase()
  if (!text) return '等待输入链接'
  return text.includes('tiktok.com') ? 'TikTok' : '独立站'
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-(--ui-text-primary)">{label}</span>
      {children}
    </label>
  )
}

function TextInput(props: React.ComponentProps<'input'>) {
  return <input {...props} className={cn('h-9 w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-3 text-sm text-(--ui-text-primary) outline-none focus:border-primary', props.className)} />
}

function TextArea(props: React.ComponentProps<'textarea'>) {
  return <textarea {...props} className={cn('min-h-32 w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-3 py-2 text-sm text-(--ui-text-primary) outline-none focus:border-primary', props.className)} />
}

function Select(props: React.ComponentProps<'select'>) {
  return <select {...props} className={cn('h-9 w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-3 text-sm text-(--ui-text-primary) outline-none focus:border-primary', props.className)} />
}

function StatusBadge({ status }: { status?: string }) {
  const normalized = String(status || '').toLowerCase()
  const label = normalized === 'pass' ? '通过' : normalized === 'warn' ? '待优化' : normalized === 'fail' ? '风险' : status || '待判断'
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded px-2 py-0.5 text-[11px]',
        normalized === 'pass' && 'bg-emerald-500/10 text-emerald-600',
        normalized === 'warn' && 'bg-amber-500/10 text-amber-600',
        normalized === 'fail' && 'bg-destructive/10 text-destructive',
        !['fail', 'pass', 'warn'].includes(normalized) && 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary)'
      )}
    >
      {label}
    </span>
  )
}

function ResultBlock({ title, value }: { title: string; value?: string }) {
  if (!value) return null
  return (
    <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3">
      <div className="mb-1 text-xs font-semibold text-(--ui-text-primary)">{title}</div>
      <div className="whitespace-pre-wrap text-sm leading-6 text-(--ui-text-secondary)">{value}</div>
    </div>
  )
}

function ResultList({ items, title }: { items?: string[]; title: string }) {
  if (!items?.length) return null
  return (
    <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3">
      <div className="mb-2 text-xs font-semibold text-(--ui-text-primary)">{title}</div>
      <ul className="space-y-1.5 text-sm leading-6 text-(--ui-text-secondary)">
        {items.map(item => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  )
}

function DiagnosisReportView({ report }: { report: GeoDiagnosisReport }) {
  return (
    <section className="space-y-4 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
      <div className="flex flex-col gap-3 border-b border-(--ui-stroke-secondary) pb-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="truncate text-xs text-(--ui-text-secondary)">{report.url}</div>
          <h2 className="mt-1 text-lg font-semibold text-(--ui-text-primary)">{report.summary || 'GEO 诊断已完成'}</h2>
        </div>
        <div className="rounded border border-primary/25 bg-primary/10 px-4 py-3 text-center">
          <div className="text-xs text-(--ui-text-secondary)">可引用度</div>
          <div className="text-2xl font-semibold text-(--ui-text-primary)">{report.score ?? '-'}</div>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(report.dimensions || []).map((dimension, index) => (
          <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3" key={dimension.key || index}>
            <div className="mb-2 flex items-start justify-between gap-2">
              <div>
                <div className="font-medium text-(--ui-text-primary)">{dimension.label || dimension.key}</div>
                <div className="mt-1 text-xs text-(--ui-text-secondary)">GEO Score {dimension.score ?? '-'}</div>
              </div>
              <StatusBadge status={dimension.status} />
            </div>
            <ResultList items={dimension.evidence} title="依据" />
            {dimension.recommendation && <p className="mt-2 text-sm leading-6 text-primary">{dimension.recommendation}</p>}
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {(report.signals || []).map((signal, index) => (
          <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3" key={signal.key || index}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="font-medium text-(--ui-text-primary)">{signal.label || signal.key}</div>
              <StatusBadge status={signal.status} />
            </div>
            {signal.evidence && <p className="text-sm text-(--ui-text-secondary)">{signal.evidence}</p>}
            {signal.recommendation && <p className="mt-2 text-sm leading-6 text-primary">{signal.recommendation}</p>}
          </div>
        ))}
      </div>
      <ResultList items={report.quickWins} title="快速优化项" />
      <ResultList items={report.limitations} title="限制" />
    </section>
  )
}

function OptimizationDraftView({ draft }: { draft: GeoOptimizationDraft }) {
  return (
    <section className="space-y-4 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
      <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3">
        <h2 className="mb-3 text-base font-semibold text-(--ui-text-primary)">GEO 7步优化清单</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {(draft.checklist || []).map((item, index) => (
            <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3" key={`${item.step || index}-${item.title || ''}`}>
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs text-primary">0{item.step || index + 1}</div>
                  <div className="font-medium text-(--ui-text-primary)">{item.title}</div>
                </div>
                <StatusBadge status={item.priority === 'high' ? 'fail' : item.priority === 'medium' ? 'warn' : 'pass'} />
              </div>
              {item.action && <div className="text-sm leading-6 text-(--ui-text-secondary)">{item.action}</div>}
              {item.output && <div className="mt-2 text-sm leading-6 text-primary">{item.output}</div>}
            </div>
          ))}
        </div>
      </div>
      <ResultBlock title="Meta Title" value={draft.meta?.title} />
      <ResultBlock title="Meta Description" value={draft.meta?.description} />
      <ResultBlock title="首屏标题" value={draft.pageCopy?.heroTitle} />
      <ResultBlock title="产品介绍" value={draft.pageCopy?.productIntro} />
      <ResultList items={draft.pageCopy?.useCases} title="使用场景" />
      {draft.faq?.length ? (
        <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3">
          <h2 className="mb-3 text-base font-semibold text-(--ui-text-primary)">FAQ</h2>
          <div className="space-y-3">
            {draft.faq.map(item => (
              <div key={item.question}>
                <div className="text-sm font-medium text-primary">{item.question}</div>
                <div className="mt-1 text-sm leading-6 text-(--ui-text-secondary)">{item.answer}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <ResultBlock title="TikTok Caption" value={draft.tiktokSuggestions?.caption} />
      <ResultBlock title="置顶评论" value={draft.tiktokSuggestions?.pinnedComment} />
      {draft.jsonLd !== undefined && (
        <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3">
          <div className="mb-2 text-xs font-semibold text-(--ui-text-primary)">JSON-LD</div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-(--ui-text-secondary)">
            {JSON.stringify(draft.jsonLd, null, 2)}
          </pre>
        </div>
      )}
    </section>
  )
}

function MonitorResultView({ result }: { result: GeoMonitorResult }) {
  return (
    <section className="space-y-4 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="样本数" value={result.summary?.checkedAnswers ?? 0} />
        <Metric label="提及率" value={`${result.summary?.mentionRate ?? 0}%`} />
        <Metric label="引用率" value={`${result.summary?.citationRate ?? 0}%`} />
      </div>
      <ResultList items={result.suggestedPrompts} title="建议监控问题" />
      {(result.answerChecks || []).map((item, index) => (
        <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3" key={`${item.provider || 'sample'}-${index}`}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="font-medium text-(--ui-text-primary)">{item.provider}</span>
            <StatusBadge status={item.mentioned ? 'pass' : 'warn'} />
            <span className="text-xs text-(--ui-text-secondary)">{item.citedTarget ? '已引用目标链接' : '未引用目标链接'}</span>
          </div>
          {item.prompt && <div className="text-sm text-(--ui-text-secondary)">{item.prompt}</div>}
          {item.evidence && <div className="mt-2 text-sm text-primary">{item.evidence}</div>}
        </div>
      ))}
      <ResultBlock title="下一步" value={result.summary?.nextAction} />
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3 text-center">
      <div className="text-xs text-(--ui-text-secondary)">{label}</div>
      <div className="mt-1 text-xl font-semibold text-(--ui-text-primary)">{value}</div>
    </div>
  )
}

export function DeepSeenGeoView() {
  const [activeTab, setActiveTab] = useState<GeoTab>('diagnose')
  const [diagnosis, setDiagnosis] = useState<GeoDiagnosisReport | null>(null)
  const [draft, setDraft] = useState<GeoOptimizationDraft | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<GeoFormState>(DEFAULT_FORM)
  const [loading, setLoading] = useState<GeoTab | null>(null)
  const [monitor, setMonitor] = useState<GeoMonitorResult | null>(null)
  const [monitorAnswers, setMonitorAnswers] = useState('')
  const [targets, setTargets] = useState<GeoTarget[]>(['faq', 'copy', 'structuredData'])

  const canSubmit = Boolean(form.url.trim())
  const current = TAB_COPY[activeTab]
  const detectedSource = useMemo(() => sourceLabel(form.url), [form.url])

  const updateForm = <K extends keyof GeoFormState>(key: K, value: GeoFormState[K]) => {
    setForm(current => ({ ...current, [key]: value }))
  }

  const toggleTarget = (target: GeoTarget) => {
    setTargets(current => (current.includes(target) ? current.filter(item => item !== target) : [...current, target]))
  }

  const run = async () => {
    if (!canSubmit) {
      setError('请输入 TikTok 或独立站链接')
      return
    }
    setError('')
    setLoading(activeTab)
    try {
      if (activeTab === 'diagnose') {
        const report = await deepseenRequest<GeoDiagnosisReport>('geo-optimization/diagnose', {
          body: {
            productName: form.productName.trim() || undefined,
            targetMarket: form.targetMarket.trim() || undefined,
            url: form.url.trim()
          },
          timeoutMs: 180_000
        })
        setDiagnosis(report)
        if (!form.productName.trim() && report.extracted?.productName) updateForm('productName', report.extracted.productName)
      } else if (activeTab === 'optimize') {
        const result = await deepseenRequest<GeoOptimizationDraft>('geo-optimization/optimize', {
          body: {
            diagnosis: diagnosis || undefined,
            optimizationTargets: targets.length ? targets : ['faq', 'copy', 'structuredData'],
            productName: form.productName.trim() || undefined,
            targetMarket: form.targetMarket.trim() || undefined,
            url: form.url.trim()
          },
          timeoutMs: 180_000
        })
        setDraft(result)
      } else {
        const result = await deepseenRequest<GeoMonitorResult>('geo-optimization/monitor/check', {
          body: {
            answers: parseMonitorAnswers(monitorAnswers),
            productName: form.productName.trim() || undefined,
            prompts: [],
            targetMarket: form.targetMarket.trim() || undefined,
            targetUrl: form.url.trim()
          },
          timeoutMs: 180_000
        })
        setMonitor(result)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GEO 任务失败')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-(--ui-editor-surface-background) pt-(--titlebar-height)">
      <div className="mx-auto w-full max-w-7xl space-y-5 p-5">
        <header className="flex flex-col gap-3 border-b border-(--ui-stroke-secondary) pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold text-primary">DeepSeen 增长工具</div>
            <h1 className="mt-1 text-2xl font-semibold text-(--ui-text-primary)">GEO优化</h1>
            <p className="mt-1 text-sm text-(--ui-text-secondary)">围绕 AI 搜索可见性，提供诊断、优化草稿和监控样本检查。</p>
          </div>
        </header>

        <section className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TAB_COPY) as GeoTab[]).map(tab => (
              <Button key={tab} onClick={() => setActiveTab(tab)} type="button" variant={activeTab === tab ? 'default' : 'outline'}>
                {TAB_COPY[tab].title}
              </Button>
            ))}
          </div>
        </section>

        <section className="grid gap-4 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.7fr)_minmax(180px,0.45fr)]">
          <Field label="链接">
            <TextInput onChange={event => updateForm('url', event.target.value)} placeholder="输入 TikTok 视频链接或独立站商品页链接" value={form.url} />
            <div className="mt-1 text-xs text-(--ui-text-secondary)">已识别：{detectedSource}</div>
          </Field>
          <Field label="产品名">
            <TextInput onChange={event => updateForm('productName', event.target.value)} placeholder="可留空，系统会优先从链接抓取" value={form.productName} />
            {diagnosis?.extracted?.crawlWarning && <div className="mt-1 text-xs text-amber-600">{diagnosis.extracted.crawlWarning}</div>}
          </Field>
          <Field label="目标市场">
            <Select onChange={event => updateForm('targetMarket', event.target.value)} value={form.targetMarket}>
              <option value="US">美国</option>
              <option value="UK">英国</option>
              <option value="EU">欧洲</option>
              <option value="JP">日本</option>
            </Select>
          </Field>
        </section>

        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <div className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
              <div className="mb-3 flex items-center gap-2">
                <Codicon className="text-primary" name={current.icon} />
                <h2 className="text-base font-semibold text-(--ui-text-primary)">{current.title}</h2>
              </div>
              <p className="mb-4 text-sm leading-6 text-(--ui-text-secondary)">{current.description}</p>

              {activeTab === 'optimize' && (
                <div className="mb-4 space-y-2">
                  <div className="text-xs font-semibold text-(--ui-text-primary)">优化目标</div>
                  <div className="flex flex-wrap gap-2">
                    {TARGET_OPTIONS.map(option => (
                      <button
                        className={cn(
                          'rounded border border-(--ui-stroke-secondary) px-2 py-1 text-xs text-(--ui-text-secondary)',
                          targets.includes(option.value) && 'border-primary bg-primary/10 text-primary'
                        )}
                        key={option.value}
                        onClick={() => toggleTarget(option.value)}
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'monitor' && (
                <Field label="AI 回答样本">
                  <TextArea onChange={event => setMonitorAnswers(event.target.value)} placeholder="粘贴 ChatGPT / Gemini / Perplexity 等回答，多个样本用空行分隔。" value={monitorAnswers} />
                </Field>
              )}

              <Button className="mt-4 w-full" disabled={!canSubmit || loading !== null} onClick={() => void run()} type="button">
                {loading === activeTab ? <Codicon name="loading" /> : <Codicon name={current.icon} />}
                {loading === activeTab ? '处理中...' : current.button}
              </Button>
            </div>
            {error && <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          </aside>

          <main>
            {activeTab === 'diagnose' ? (
              diagnosis ? <DiagnosisReportView report={diagnosis} /> : <EmptyState text="输入链接后开始 GEO 诊断，这里会展示可引用度评分、问题项和快速优化建议。" />
            ) : activeTab === 'optimize' ? (
              draft ? <OptimizationDraftView draft={draft} /> : <EmptyState text="生成后这里会展示 FAQ、页面文案、Meta 信息、JSON-LD 和 TikTok 承接建议。" />
            ) : monitor ? (
              <MonitorResultView result={monitor} />
            ) : (
              <EmptyState text="粘贴 AI 回答样本后检查是否提及品牌/产品、是否引用目标链接。" />
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="grid min-h-80 place-items-center rounded-md border border-dashed border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-6 text-center text-sm text-(--ui-text-secondary)">
      {text}
    </div>
  )
}
