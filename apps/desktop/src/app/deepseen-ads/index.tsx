import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { analyzeDeepSeenAdDiagnosisFile, deepseenRequest } from '@/hermes'
import { cn } from '@/lib/utils'

type AdStage = 'TESTING' | 'SCALING' | 'STABLE'

interface StoredAdDiagnosisReport {
  id: string
  createdAt?: string
  report?: AdDiagnosisReport
}

interface AdDiagnosisReport {
  decisions?: {
    scale?: AdMaterial[]
    stop?: AdMaterial[]
    watch?: AdMaterial[]
  }
  fileName?: string
  funnel?: Record<string, unknown>
  materials?: {
    lowExposure?: AdMaterial[]
    star?: AdMaterial[]
  }
  settings?: Record<string, unknown>
  summary?: unknown
}

interface AdMaterial {
  adName?: string
  campaignName?: string
  decisionLabel?: string
  materialName?: string
  reason?: string
  spend?: number
}

const DEFAULT_SETTINGS = {
  adAgeDays: '3',
  grossProfitPerOrder: '10',
  minCtr: '2',
  minCvr: '1',
  minImpressions: '1000',
  minOrders: '2',
  stage: 'TESTING' as AdStage,
  stopLossMultiple: '2',
  targetCpa: '10',
  targetRoi: '1.5',
  targetTestOrders: '5'
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-(--ui-text-primary)">{label}</span>
      {children}
    </label>
  )
}

function Input(props: React.ComponentProps<'input'>) {
  return <input {...props} className={cn('h-9 w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-3 text-sm text-(--ui-text-primary) outline-none focus:border-primary', props.className)} />
}

function Select(props: React.ComponentProps<'select'>) {
  return <select {...props} className={cn('h-9 w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-3 text-sm text-(--ui-text-primary) outline-none focus:border-primary', props.className)} />
}

function materialName(item: AdMaterial): string {
  return item.materialName || item.adName || item.campaignName || '未命名素材'
}

function SummaryCard({ count, title }: { count: number; title: string }) {
  return (
    <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3">
      <div className="text-xs text-(--ui-text-secondary)">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-(--ui-text-primary)">{count}</div>
    </div>
  )
}

const METRIC_LABELS: Record<string, string> = {
  cpa: 'CPA',
  cpm: 'CPM',
  ctr: 'CTR',
  cvr: 'CVR',
  healthScore: '健康分',
  recommendedBudget: '建议预算',
  roi: 'ROI',
  rowCount: '数据行数',
  topCostMaterial: '最高花费素材',
  topCostShare: '最高花费占比',
  totalClicks: '总点击',
  totalCost: '总花费',
  totalImpressions: '总曝光',
  totalOrders: '总订单',
  totalRevenue: '总收入'
}

function formatMetricValue(key: string, value: unknown): string {
  if (value == null || value === '') {
    return '暂无'
  }

  if (typeof value === 'number') {
    const lowerKey = key.toLowerCase()
    if (['ctr', 'cvr', 'roi', 'topcostshare'].includes(lowerKey)) {
      return `${Number.isInteger(value) ? value : value.toFixed(2)}%`
    }

    if (['cpa', 'cpm', 'totalcost', 'totalrevenue', 'recommendedbudget'].includes(lowerKey)) {
      return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
    }

    return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return String(value)
  }

  return JSON.stringify(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function SummaryBlock({ summary }: { summary: unknown }) {
  if (!summary) {
    return null
  }

  if (typeof summary === 'string') {
    return <p className="mt-4 rounded border border-primary/20 bg-primary/5 p-3 text-sm text-(--ui-text-primary)">{summary}</p>
  }

  if (!isPlainObject(summary)) {
    return null
  }

  const entries = Object.entries(summary).filter(([, value]) => value !== undefined && value !== null && value !== '')
  if (!entries.length) {
    return null
  }

  return (
    <div className="mt-4 rounded border border-primary/20 bg-primary/5 p-3">
      <div className="text-sm font-semibold text-(--ui-text-primary)">核心指标</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {entries.map(([key, value]) => (
          <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-2" key={key}>
            <div className="text-[11px] text-(--ui-text-secondary)">{METRIC_LABELS[key] || key}</div>
            <div className="mt-1 truncate text-sm font-semibold text-(--ui-text-primary)" title={formatMetricValue(key, value)}>
              {formatMetricValue(key, value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReportPanel({ report }: { report: AdDiagnosisReport }) {
  const scale = report.decisions?.scale || []
  const watch = report.decisions?.watch || []
  const stop = report.decisions?.stop || []
  const star = report.materials?.star || []
  const lowExposure = report.materials?.lowExposure || []
  return (
    <section className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-(--ui-text-primary)">广告投放诊断报告</h2>
          <p className="mt-1 text-xs text-(--ui-text-secondary)">{report.fileName || 'DeepSeen 广告数据'}</p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <SummaryCard count={scale.length} title="建议加预算" />
        <SummaryCard count={watch.length} title="继续观察" />
        <SummaryCard count={stop.length} title="建议止损" />
        <SummaryCard count={star.length} title="明星素材" />
        <SummaryCard count={lowExposure.length} title="低曝素材" />
      </div>
      <SummaryBlock summary={report.summary || report.funnel} />
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {[
          ['加预算素材', scale],
          ['观察素材', watch],
          ['止损素材', stop]
        ].map(([title, items]) => (
          <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3" key={String(title)}>
            <div className="text-sm font-semibold text-(--ui-text-primary)">{String(title)}</div>
            <div className="mt-3 space-y-2">
              {(items as AdMaterial[]).slice(0, 5).map((item, index) => (
                <div className="rounded bg-(--ui-bg-tertiary) p-2 text-xs" key={`${materialName(item)}-${index}`}>
                  <div className="font-semibold text-(--ui-text-primary)">{materialName(item)}</div>
                  <div className="mt-1 text-(--ui-text-secondary)">{item.reason || item.decisionLabel || '等待更多数据验证'}</div>
                </div>
              ))}
              {(items as AdMaterial[]).length === 0 && <div className="text-xs text-(--ui-text-secondary)">暂无</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function DeepSeenAdsView() {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [filePath, setFilePath] = useState('')
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [latest, setLatest] = useState<StoredAdDiagnosisReport | null>(null)
  const [reports, setReports] = useState<StoredAdDiagnosisReport[]>([])

  const loadReports = async () => {
    try {
      const data = await deepseenRequest<StoredAdDiagnosisReport[]>('ad-diagnosis/reports?limit=20', { timeoutMs: 60_000 })
      setReports(data || [])
      setLatest(data?.[0] || null)
    } catch {
      setReports([])
    }
  }

  useEffect(() => {
    void loadReports()
  }, [])

  const pickFile = (next: File | null) => {
    setFile(next)
    setFilePath(next ? window.hermesDesktop?.getPathForFile?.(next) || '' : '')
  }

  const analyze = async () => {
    if (!file || !filePath) {
      setError('请先选择广告数据文件')
      return
    }
    setLoading(true)
    setError('')
    try {
      const stored = await analyzeDeepSeenAdDiagnosisFile<StoredAdDiagnosisReport>({
        fields: {
          ...settings,
          adAgeDays: Number(settings.adAgeDays),
          grossProfitPerOrder: Number(settings.grossProfitPerOrder),
          minCtr: Number(settings.minCtr),
          minCvr: Number(settings.minCvr),
          minImpressions: Number(settings.minImpressions),
          minOrders: Number(settings.minOrders),
          stopLossMultiple: Number(settings.stopLossMultiple),
          targetCpa: Number(settings.targetCpa),
          targetRoi: Number(settings.targetRoi),
          targetTestOrders: Number(settings.targetTestOrders)
        },
        filePath,
        filename: file.name
      })
      setLatest(stored)
      await loadReports()
    } catch (err) {
      setError(err instanceof Error ? err.message : '广告投放诊断失败')
    } finally {
      setLoading(false)
    }
  }

  const update = (key: keyof typeof DEFAULT_SETTINGS, value: string) => {
    setSettings(current => ({ ...current, [key]: value }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-(--ui-editor-surface-background) pt-(--titlebar-height)">
      <div className="mx-auto w-full max-w-7xl space-y-5 p-5">
        <header className="flex flex-col gap-3 border-b border-(--ui-stroke-secondary) pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold text-primary">DeepSeen 投放工具</div>
            <h1 className="mt-1 text-2xl font-semibold text-(--ui-text-primary)">广告投放</h1>
            <p className="mt-1 text-sm text-(--ui-text-secondary)">按 DeepSeen Web 广告诊断接口接入，上传投放数据后输出素材分层、止损/加预算建议和报告记录。</p>
          </div>
          <Button onClick={() => void loadReports()} type="button" variant="outline">
            <Codicon name="refresh" />
            刷新报告
          </Button>
        </header>

        <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
          <main className="space-y-5">
            <section className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
              <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
                <div className="space-y-3">
                  <div className="rounded border border-dashed border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-4 text-center">
                    <div className="text-sm font-semibold text-(--ui-text-primary)">{file?.name || '上传广告数据文件'}</div>
                    <p className="mt-2 text-xs text-(--ui-text-secondary)">支持 DeepSeen Web 同款 CSV / XLSX / 导出的投放数据文件。</p>
                    <Button className="mt-4" disabled={loading} onClick={() => inputRef.current?.click()} size="sm" type="button" variant="outline">
                      <Codicon name="cloud-upload" />
                      选择文件
                    </Button>
                    <input
                      ref={inputRef}
                      accept=".csv,.xlsx,.xls"
                      className="hidden"
                      onChange={event => pickFile(event.target.files?.[0] || null)}
                      type="file"
                    />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <Field label="投放阶段">
                    <Select disabled={loading} onChange={event => update('stage', event.target.value)} value={settings.stage}>
                      <option value="TESTING">测试期</option>
                      <option value="SCALING">放量期</option>
                      <option value="STABLE">稳定期</option>
                    </Select>
                  </Field>
                  <Field label="广告天数">
                    <Input disabled={loading} onChange={event => update('adAgeDays', event.target.value)} type="number" value={settings.adAgeDays} />
                  </Field>
                  <Field label="单单毛利">
                    <Input disabled={loading} onChange={event => update('grossProfitPerOrder', event.target.value)} type="number" value={settings.grossProfitPerOrder} />
                  </Field>
                  <Field label="目标 ROI">
                    <Input disabled={loading} onChange={event => update('targetRoi', event.target.value)} type="number" value={settings.targetRoi} />
                  </Field>
                  <Field label="目标 CPA">
                    <Input disabled={loading} onChange={event => update('targetCpa', event.target.value)} type="number" value={settings.targetCpa} />
                  </Field>
                  <Field label="止损倍数">
                    <Input disabled={loading} onChange={event => update('stopLossMultiple', event.target.value)} type="number" value={settings.stopLossMultiple} />
                  </Field>
                  <Field label="测试目标订单">
                    <Input disabled={loading} onChange={event => update('targetTestOrders', event.target.value)} type="number" value={settings.targetTestOrders} />
                  </Field>
                  <Field label="最低 CTR%">
                    <Input disabled={loading} onChange={event => update('minCtr', event.target.value)} type="number" value={settings.minCtr} />
                  </Field>
                  <Field label="最低 CVR%">
                    <Input disabled={loading} onChange={event => update('minCvr', event.target.value)} type="number" value={settings.minCvr} />
                  </Field>
                  <Field label="最低订单">
                    <Input disabled={loading} onChange={event => update('minOrders', event.target.value)} type="number" value={settings.minOrders} />
                  </Field>
                  <Field label="最低曝光">
                    <Input disabled={loading} onChange={event => update('minImpressions', event.target.value)} type="number" value={settings.minImpressions} />
                  </Field>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button disabled={loading || !filePath} onClick={() => void analyze()} type="button">
                  <Codicon name="play" />
                  {loading ? '诊断中' : '开始诊断'}
                </Button>
                <Button disabled={loading} onClick={() => {
                  pickFile(null)
                  setSettings(DEFAULT_SETTINGS)
                  setError('')
                }} type="button" variant="outline">
                  重置
                </Button>
              </div>
            </section>

            {error && <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            {loading && (
              <section className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
                <div className="text-sm font-semibold text-(--ui-text-primary)">正在分析广告投放数据</div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-(--ui-bg-tertiary)">
                  <div className="h-full w-2/3 animate-pulse bg-primary" />
                </div>
                <p className="mt-2 text-xs text-(--ui-text-secondary)">DeepSeen 正在进行素材分层、投放诊断和决策建议。</p>
              </section>
            )}
            {latest?.report && <ReportPanel report={latest.report} />}
          </main>

          <aside className="space-y-3">
            <h2 className="text-sm font-semibold text-(--ui-text-primary)">最近报告</h2>
            {reports.length === 0 ? (
              <div className="rounded border border-(--ui-stroke-secondary) p-4 text-xs text-(--ui-text-secondary)">暂无报告</div>
            ) : (
              reports.map(item => (
                <button
                  className="w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3 text-left hover:border-primary/60"
                  key={item.id}
                  onClick={() => setLatest(item)}
                  type="button"
                >
                  <div className="truncate text-xs font-semibold text-(--ui-text-primary)">{item.report?.fileName || item.id}</div>
                  <div className="mt-1 text-[11px] text-(--ui-text-secondary)">{item.createdAt || '报告记录'}</div>
                </button>
              ))
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
