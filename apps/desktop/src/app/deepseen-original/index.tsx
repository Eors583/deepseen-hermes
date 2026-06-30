import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  cancelDeepSeenTask,
  deepseenRequest,
  streamDeepSeenTask,
  type DeepSeenTaskProgress,
  uploadDeepSeenDataUrl,
  uploadDeepSeenFile
} from '@/hermes'
import { cn } from '@/lib/utils'

type OriginalMode = 'IMAGE' | 'VIDEO'

interface StartTaskResponse {
  recreationId?: string
  taskId: string
}

interface RecreationDetail {
  id: string
  resultImages?: Record<string, string>
  resultVideos?: Record<string, string>
  status?: string
}

interface RecreationListResponse {
  items?: RecreationDetail[]
}

const IMAGE_MODELS = [
  { id: 'nano-banana-2', label: 'Nano Banana 2' },
  { id: 'gpt-image-1', label: 'GPT Image' }
]

const VIDEO_MODELS = [
  { id: 'seedance-2.0-zkj-15s', label: 'Seedance2.0_ZKJ - 15s', duration: '15s' },
  { id: 'veo-3.1-stable', label: 'VEO 3.1 稳定版 - 8s', duration: '8s' },
  { id: 'Gemini Omni Video', label: 'Gemini Omni - 10s', duration: '10s' },
  { id: 'grok-video-10s', label: 'Grok Video - 10s', duration: '10s' },
  { id: 'grok-imagine-video-1-5-preview', label: 'Grok Video 1.5 - 15s', duration: '15s' },
  { id: 'ltx-2.3-10s', label: 'LTX 2.3 - 10s', duration: '10s' }
]

const ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const
const IMAGE_MAX_BYTES = 20 * 1024 * 1024

function dataUrlForFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}

function progressPercent(progress: DeepSeenTaskProgress | null): number {
  const raw = Number(progress?.progress ?? 0)
  if (!Number.isFinite(raw)) return 0
  return raw <= 1 ? Math.round(raw * 100) : Math.max(0, Math.min(100, Math.round(raw)))
}

function resultUrls(detail: RecreationDetail | null, mode: OriginalMode): string[] {
  const source = mode === 'IMAGE' ? detail?.resultImages : detail?.resultVideos
  return Object.values(source || {}).filter(Boolean)
}

function downloadUrl(url: string): void {
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noreferrer'
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
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

function TextArea(props: React.ComponentProps<'textarea'>) {
  return <textarea {...props} className={cn('min-h-36 w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-3 py-2 text-sm text-(--ui-text-primary) outline-none focus:border-primary', props.className)} />
}

function Select(props: React.ComponentProps<'select'>) {
  return <select {...props} className={cn('h-9 w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-3 text-sm text-(--ui-text-primary) outline-none focus:border-primary', props.className)} />
}

function ReferenceUploader({
  disabled,
  max,
  onChange,
  values
}: {
  disabled?: boolean
  max: number
  onChange: (values: string[]) => void
  values: string[]
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    setError('')
    try {
      const next = [...values]
      for (const file of Array.from(files).slice(0, Math.max(0, max - values.length))) {
        if (file.size > IMAGE_MAX_BYTES) throw new Error(`${file.name} 超过 20MB 上传上限`)
        const filePath = window.hermesDesktop?.getPathForFile?.(file) || ''
        const uploaded = filePath
          ? await uploadDeepSeenFile({ filePath, filename: file.name, type: 'recreation' })
          : await uploadDeepSeenDataUrl({ dataUrl: await dataUrlForFile(file), filename: file.name, type: 'recreation' })
        next.push(uploaded.url)
      }
      onChange(next.slice(0, max))
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传素材失败')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold text-(--ui-text-primary)">参考图 / 产品图</div>
        <Button disabled={disabled || uploading || values.length >= max} onClick={() => inputRef.current?.click()} size="xs" type="button" variant="outline">
          <Codicon name="cloud-upload" />
          {uploading ? '上传中' : '上传'}
        </Button>
      </div>
      <input ref={inputRef} accept="image/*" className="hidden" multiple onChange={event => void uploadFiles(event.target.files)} type="file" />
      {error && <div className="text-xs text-destructive">{error}</div>}
      <div className="grid grid-cols-3 gap-2">
        {values.map((url, index) => (
          <div className="group relative aspect-square overflow-hidden rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-tertiary)" key={`${url}-${index}`}>
            <img alt="" className="h-full w-full object-cover" src={url} />
            <button
              className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
              onClick={() => onChange(values.filter(item => item !== url))}
              type="button"
            >
              移除
            </button>
          </div>
        ))}
        {values.length === 0 && <div className="col-span-full rounded border border-dashed border-(--ui-stroke-secondary) p-4 text-center text-xs text-(--ui-text-secondary)">暂未上传素材</div>}
      </div>
    </div>
  )
}

export function DeepSeenOriginalView() {
  const [mode, setMode] = useState<OriginalMode>('IMAGE')
  const [phase, setPhase] = useState<'input' | 'generating' | 'done'>('input')
  const [error, setError] = useState('')
  const [taskId, setTaskId] = useState('')
  const [recreationId, setRecreationId] = useState('')
  const [progress, setProgress] = useState<DeepSeenTaskProgress | null>(null)
  const [detail, setDetail] = useState<RecreationDetail | null>(null)
  const [history, setHistory] = useState<RecreationDetail[]>([])
  const [referenceImages, setReferenceImages] = useState<string[]>([])
  const [script, setScript] = useState('')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [count, setCount] = useState(1)
  const [duration, setDuration] = useState('15s')
  const [imageModel, setImageModel] = useState(IMAGE_MODELS[0].id)
  const [videoModel, setVideoModel] = useState(VIDEO_MODELS[0].id)
  const [enhancePrompt, setEnhancePrompt] = useState(false)
  const busy = phase === 'generating'

  const refreshHistory = useCallback(async () => {
    try {
      const data = await deepseenRequest<RecreationListResponse>(`recreation/list?limit=12&type=${mode}&mode=ORIGINAL`, { timeoutMs: 60_000 })
      setHistory(data.items || [])
    } catch {
      setHistory([])
    }
  }, [mode])

  useEffect(() => {
    void refreshHistory()
  }, [refreshHistory])

  useEffect(() => {
    if (!taskId || !busy) return undefined
    const cleanup = streamDeepSeenTask(taskId, {
      onProgress: setProgress,
      onComplete: async next => {
        setProgress(next)
        const status = String(next.status || '').toUpperCase()
        if (status === 'COMPLETED' || status === 'SUCCESS') {
          const rId = String(next.result?.recreationId || recreationId || '')
          if (rId) {
            try {
              setDetail(await deepseenRequest<RecreationDetail>(`recreation/${encodeURIComponent(rId)}`, { timeoutMs: 60_000 }))
            } catch {}
          }
          setPhase('done')
          void refreshHistory()
          return
        }
        setError(next.error || next.message || '任务未完成')
        setPhase('input')
        void refreshHistory()
      },
      onError: err => setError(err.message || '任务进度连接失败')
    })
    return cleanup
  }, [busy, recreationId, refreshHistory, taskId])

  const submit = async (options: { modelRiskAccepted?: boolean } = {}) => {
    if (!script.trim()) {
      setError('请输入原创脚本或创意描述')
      return
    }
    setError('')
    setProgress(null)
    setDetail(null)
    setPhase('generating')
    try {
      const endpoint = mode === 'IMAGE' ? 'recreation/original' : 'recreation/original-video'
      const modelId = mode === 'IMAGE' ? imageModel : videoModel
      const body: Record<string, unknown> = {
        mode: 'SCRIPT',
        baseImageUrl: referenceImages[0],
        baseImageUrls: referenceImages,
        fullScript: script,
        count,
        aspectRatio,
        enhancePrompt,
        modelId,
        modelRiskAccepted: Boolean(options.modelRiskAccepted)
      }
      if (mode === 'VIDEO') {
        body.duration = duration
        body.region = '美国'
      }
      const started = await deepseenRequest<StartTaskResponse>(endpoint, { body, timeoutMs: 300_000 })
      setTaskId(started.taskId)
      setRecreationId(started.recreationId || '')
    } catch (err) {
      const message = err instanceof Error ? err.message : '原创内容任务启动失败'
      if (message.includes('MODEL_HIGH_FAILURE_RATE_ACK_REQUIRED') || message.includes('失败率')) {
        if (window.confirm(`${message}\n\n是否继续使用当前模型？`)) {
          await submit({ modelRiskAccepted: true })
          return
        }
      }
      setError(message)
      setPhase('input')
    }
  }

  const cancel = async () => {
    if (taskId) {
      try {
        await cancelDeepSeenTask(taskId)
      } catch {}
    }
    setPhase('input')
    setTaskId('')
  }

  const outputs = resultUrls(detail, mode)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-(--ui-editor-surface-background) pt-(--titlebar-height)">
      <div className="mx-auto w-full max-w-7xl space-y-5 p-5">
        <header className="flex flex-col gap-3 border-b border-(--ui-stroke-secondary) pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold text-primary">DeepSeen 创作工作台</div>
            <h1 className="mt-1 text-2xl font-semibold text-(--ui-text-primary)">原创内容</h1>
            <p className="mt-1 text-sm text-(--ui-text-secondary)">按 DeepSeen Web 原创图片/原创视频接口接入，支持参考图、创意脚本、任务进度、历史和产物回显。</p>
          </div>
          <Button onClick={() => void refreshHistory()} type="button" variant="outline">
            <Codicon name="refresh" />
            刷新历史
          </Button>
        </header>

        <section className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setMode('IMAGE')} type="button" variant={mode === 'IMAGE' ? 'default' : 'outline'}>原创图片</Button>
            <Button onClick={() => setMode('VIDEO')} type="button" variant={mode === 'VIDEO' ? 'default' : 'outline'}>原创视频</Button>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
          <main className="space-y-5">
            <section className="grid gap-4 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4 lg:grid-cols-[320px_1fr]">
              <ReferenceUploader disabled={busy} max={mode === 'IMAGE' ? 10 : 9} onChange={setReferenceImages} values={referenceImages} />
              <div className="space-y-4">
                <Field label="原创脚本 / 创意描述">
                  <TextArea disabled={busy} onChange={event => setScript(event.target.value)} placeholder="描述画面、场景、主体、动作、风格、卖点；也可以粘贴完整分镜脚本。" value={script} />
                </Field>
                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="比例">
                    <Select disabled={busy} onChange={event => setAspectRatio(event.target.value)} value={aspectRatio}>
                      {ASPECT_RATIOS.map(value => <option key={value} value={value}>{value}</option>)}
                    </Select>
                  </Field>
                  <Field label="模型">
                    <Select disabled={busy} onChange={event => {
                      if (mode === 'IMAGE') setImageModel(event.target.value)
                      else {
                        setVideoModel(event.target.value)
                        setDuration(VIDEO_MODELS.find(item => item.id === event.target.value)?.duration || duration)
                      }
                    }} value={mode === 'IMAGE' ? imageModel : videoModel}>
                      {(mode === 'IMAGE' ? IMAGE_MODELS : VIDEO_MODELS).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </Select>
                  </Field>
                  {mode === 'VIDEO' && (
                    <Field label="时长">
                      <Select disabled={busy} onChange={event => setDuration(event.target.value)} value={duration}>
                        {['8s', '10s', '15s', '20s', '24s', '30s'].map(value => <option key={value} value={value}>{value}</option>)}
                      </Select>
                    </Field>
                  )}
                  <Field label="数量">
                    <Input disabled={busy} max={10} min={1} onChange={event => setCount(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} type="number" value={count} />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-xs text-(--ui-text-secondary)">
                  <input checked={enhancePrompt} disabled={busy} onChange={event => setEnhancePrompt(event.target.checked)} type="checkbox" />
                  使用 DeepSeen 提示词增强
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy || !script.trim()} onClick={() => void submit()} type="button">
                    <Codicon name="play" />
                    开始生成
                  </Button>
                  <Button disabled={busy} onClick={() => {
                    setScript('')
                    setReferenceImages([])
                    setDetail(null)
                    setProgress(null)
                    setPhase('input')
                  }} type="button" variant="outline">
                    重置
                  </Button>
                </div>
              </div>
            </section>

            {error && <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            {busy && (
              <section className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-(--ui-text-primary)">正在生成原创内容</div>
                  <Button onClick={() => void cancel()} size="sm" type="button" variant="outline">取消任务</Button>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-(--ui-bg-tertiary)">
                  <div className="h-full bg-primary transition-all" style={{ width: `${progressPercent(progress)}%` }} />
                </div>
                <div className="mt-2 text-xs text-(--ui-text-secondary)">{progress?.message || progress?.step || progress?.status || '等待任务进度'}</div>
              </section>
            )}
            {phase === 'done' && (
              <section className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
                <h2 className="text-base font-semibold text-(--ui-text-primary)">生成结果</h2>
                {outputs.length ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {outputs.map(url => (
                      <article className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3" key={url}>
                        <div className="aspect-video overflow-hidden rounded bg-(--ui-bg-tertiary)">
                          {mode === 'IMAGE' ? <img alt="" className="h-full w-full object-contain" src={url} /> : <video className="h-full w-full" controls src={url} />}
                        </div>
                        <div className="mt-3 flex justify-end">
                          <Button onClick={() => downloadUrl(url)} size="xs" type="button" variant="outline">下载</Button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded border border-dashed border-(--ui-stroke-secondary) p-4 text-sm text-(--ui-text-secondary)">任务已完成，但暂未同步到可预览产物。请稍后刷新历史。</div>
                )}
              </section>
            )}
          </main>

          <aside className="space-y-3">
            <h2 className="text-sm font-semibold text-(--ui-text-primary)">最近生成</h2>
            {history.length === 0 ? (
              <div className="rounded border border-(--ui-stroke-secondary) p-4 text-xs text-(--ui-text-secondary)">暂无历史记录</div>
            ) : (
              history.map(item => {
                const urls = resultUrls(item, mode)
                return (
                  <button className="w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3 text-left hover:border-primary/60" key={item.id} onClick={() => {
                    setDetail(item)
                    setRecreationId(item.id)
                    setPhase(urls.length ? 'done' : 'input')
                  }} type="button">
                    <div className="truncate text-xs font-semibold text-(--ui-text-primary)">{item.id}</div>
                    <div className="mt-1 text-[11px] text-(--ui-text-secondary)">{item.status || 'UNKNOWN'} / {urls.length} 个产物</div>
                  </button>
                )
              })
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
