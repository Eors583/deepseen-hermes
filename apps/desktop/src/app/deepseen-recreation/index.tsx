import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  cancelDeepSeenTask,
  confirmDeepSeenTaskFallback,
  DeepSeenApiError,
  deepseenRequest,
  getDeepSeenTaskStatus,
  type DeepSeenTaskProgress,
  uploadDeepSeenDataUrl,
  uploadDeepSeenFile
} from '@/hermes'
import { cn } from '@/lib/utils'

type RecreationKind = 'image' | 'video'
type ImageMode = 'recreate' | 'smart'
type VideoMode = 'recreate' | 'smart' | 'mixcut'
type WorkPhase = 'input' | 'analyzing' | 'confirming' | 'generating' | 'done'

interface RecreationDetail {
  baseImageUrl?: string
  baseImageUrls?: string[]
  id: string
  productUrl?: string
  promptData?: Record<string, unknown>
  result?: Record<string, unknown>
  resultImages?: Record<string, string>
  resultVideos?: Record<string, string>
  scriptData?: Record<string, unknown>
  status?: string
  type?: 'IMAGE' | 'VIDEO'
}

interface RecreationListResponse {
  items?: RecreationDetail[]
}

interface ProductPreview {
  images?: string[]
  price?: string
  sellingPoints?: string[]
  title?: string
}

interface StartTaskResponse {
  recreationId?: string
  taskId: string
}

interface MediaItem {
  label: string
  url: string
}

const IMAGE_MODEL_OPTIONS = [
  { id: 'nano-banana-2', label: 'Nano Banana 2' },
  { id: 'gpt-image-1', label: 'GPT Image' }
]

const VIDEO_MODEL_OPTIONS = [
  { id: 'seedance-2.0-zkj-15s', label: 'SeeDance 15s' },
  { id: 'veo-3.1-stable', label: 'VEO 3.1 Stable' },
  { id: 'veo-3.1-lite', label: 'VEO 3.1 Lite' },
  { id: 'grok-video-10s', label: 'Grok Video 10s' }
]

const SMART_VIDEO_OPTIONS = [
  { id: 'SeeDance15s_ZKJ', label: 'SeeDance 15s' },
  { id: 'Veo8s', label: 'VEO 8s' },
  { id: 'GeminiOmni10s', label: 'Gemini Omni 10s' },
  { id: 'Grok1_5', label: 'Grok 1.5' }
]

const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_UPLOAD_BYTES = 300 * 1024 * 1024

function normalizedStatus(status?: string): string {
  return String(status || '').trim().toUpperCase()
}

function isComplete(status?: string): boolean {
  return ['COMPLETED', 'FAILED', 'CANCELLED', 'SUCCESS'].includes(normalizedStatus(status))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function dataUrlForFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(file)
  })
}

function secondsFromDuration(value: string): number {
  const seconds = Number.parseInt(value, 10)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 15
}

function progressPercent(progress: DeepSeenTaskProgress | null): number {
  const raw = Number(progress?.progress ?? 0)
  if (!Number.isFinite(raw)) return 0
  return raw <= 1 ? Math.round(raw * 100) : Math.max(0, Math.min(100, Math.round(raw)))
}

function progressLogs(progress: DeepSeenTaskProgress | null): string[] {
  return (progress?.logs || [])
    .map(item => (typeof item === 'string' ? item : item.message || item.stage || ''))
    .filter(Boolean)
    .slice(-8)
}

function needsFallbackDecision(progress: DeepSeenTaskProgress | null): boolean {
  return progress?.actionRequired?.type === 'VIDEO_FALLBACK_CONFIRMATION' || progress?.actionId === 'video-fallback' || Boolean(progress?.fallback)
}

function fallbackMessage(progress: DeepSeenTaskProgress | null): string {
  return progress?.actionRequired?.message || progress?.fallback?.message || progress?.message || ''
}

function collectMediaMaps(value: unknown, key: 'resultImages' | 'resultVideos'): Record<string, unknown>[] {
  if (!isRecord(value)) return []
  const direct = isRecord(value[key]) ? [value[key] as Record<string, unknown>] : []
  return [
    ...direct,
    ...collectMediaMaps(value.result, key),
    ...collectMediaMaps(value.data, key),
    ...collectMediaMaps(value.output, key)
  ]
}

function resultMedia(detail: RecreationDetail | null, progress: DeepSeenTaskProgress | null, kind: RecreationKind): MediaItem[] {
  const key = kind === 'image' ? 'resultImages' : 'resultVideos'
  const maps = [
    ...collectMediaMaps(detail, key),
    ...collectMediaMaps(progress, key),
    ...collectMediaMaps(progress?.result, key)
  ]
  const seen = new Set<string>()
  return maps
    .flatMap(map =>
      Object.entries(map)
        .filter(([, url]) => typeof url === 'string' && Boolean(url))
        .map(([label, url]) => ({ label, url: String(url) }))
    )
    .filter(item => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
}

function promptVariants(detail: RecreationDetail | null): Array<{ id: string; text: string }> {
  const variants = detail?.promptData?.prompt_variants
  if (!Array.isArray(variants)) return []
  return variants
    .map((item, index) => {
      if (!isRecord(item)) return null
      const text = item.displayPromptZh || item.promptZh || item.videoPromptZh || item.prompt
      return {
        id: String(item.variant_id || item.id || `variant-${index + 1}`),
        text: typeof text === 'string' ? text : JSON.stringify(text ?? '', null, 2)
      }
    })
    .filter((item): item is { id: string; text: string } => Boolean(item?.text))
}

function historyTitle(item: RecreationDetail): string {
  const script = item.scriptData || {}
  const prompt = item.promptData || {}
  return String(
    script.productTitle ||
      script.product_title ||
      prompt.productTitle ||
      prompt.product_title ||
      prompt.keywords ||
      item.productUrl ||
      item.id
  )
}

function firstOutputUrl(item: RecreationDetail, kind: RecreationKind): string {
  return resultMedia(item, null, kind)[0]?.url || ''
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

function TaskProgressCard({
  fallbackConfirming,
  onCancel,
  onFallbackContinue,
  phase,
  progress
}: {
  fallbackConfirming?: boolean
  onCancel: () => void
  onFallbackContinue: () => void
  phase: WorkPhase
  progress: DeepSeenTaskProgress | null
}) {
  const percent = progressPercent(progress)
  const logs = progressLogs(progress)
  const fallback = needsFallbackDecision(progress)
  return (
    <section className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-(--ui-text-primary)">
            {phase === 'analyzing' ? '正在分析素材' : phase === 'generating' ? '正在生成内容' : '正在处理任务'}
          </div>
          <div className="mt-1 text-xs text-(--ui-text-secondary)">
            任务会持续运行，视频生成可能需要较长时间；完成后会展示预览和下载入口。
          </div>
        </div>
        {progress && !isComplete(progress.status) && (
          <Button onClick={onCancel} size="sm" type="button" variant="outline">
            取消任务
          </Button>
        )}
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-(--ui-bg-tertiary)">
        <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-(--ui-text-secondary)">
        <span>{progress?.message || progress?.step || progress?.status || '等待任务进度'}</span>
        <span>{percent}%</span>
      </div>

      {fallback && (
        <div className="mt-3 flex flex-col gap-3 rounded border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-(--ui-text-primary) sm:flex-row sm:items-center sm:justify-between">
          <div>{fallbackMessage(progress) || '当前视频需要确认后继续生成。'}</div>
          <div className="flex shrink-0 gap-2">
            <Button disabled={fallbackConfirming} onClick={onFallbackContinue} size="sm" type="button">
              继续生成
            </Button>
            <Button disabled={fallbackConfirming} onClick={onCancel} size="sm" type="button" variant="outline">
              放弃本次
            </Button>
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="mt-3 space-y-1 rounded bg-(--ui-bg-primary) p-3 text-xs text-(--ui-text-secondary)">
          {logs.map((log, index) => (
            <div key={`${index}-${log}`}>- {log}</div>
          ))}
        </div>
      )}
      {progress?.status === 'FAILED' && (
        <div className="mt-3 rounded border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {progress.error || '任务失败，请调整素材后重试。'}
        </div>
      )}
    </section>
  )
}

function UploadStrip({
  accept,
  disabled,
  label,
  max,
  onChange,
  values
}: {
  accept: string
  disabled?: boolean
  label: string
  max: number
  onChange: (values: string[]) => void
  values: string[]
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploadError, setUploadError] = useState('')
  const [uploading, setUploading] = useState(false)

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    setUploadError('')
    try {
      const next = [...values]
      const maxBytes = accept.includes('video') ? MAX_VIDEO_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES
      for (const file of Array.from(files).slice(0, Math.max(0, max - values.length))) {
        if (file.size > maxBytes) {
          const limitMb = Math.round(maxBytes / 1024 / 1024)
          const sizeMb = (file.size / 1024 / 1024).toFixed(1)
          throw new Error(`${file.name} 为 ${sizeMb}MB，超过 ${limitMb}MB 上传上限`)
        }
        const filePath = window.hermesDesktop?.getPathForFile?.(file) || ''
        const uploaded = filePath
          ? await uploadDeepSeenFile({ filePath, filename: file.name, type: 'recreation' })
          : await uploadDeepSeenDataUrl({ dataUrl: await dataUrlForFile(file), filename: file.name, type: 'recreation' })
        next.push(uploaded.url)
      }
      onChange(next.slice(0, max))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '上传素材失败')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-(--ui-text-primary)">{label}</label>
        <Button disabled={disabled || uploading || values.length >= max} onClick={() => inputRef.current?.click()} size="xs" type="button" variant="outline">
          <Codicon name="cloud-upload" />
          {uploading ? '上传中' : '上传'}
        </Button>
      </div>
      <input ref={inputRef} accept={accept} className="hidden" multiple={max > 1} onChange={event => void uploadFiles(event.target.files)} type="file" />
      {uploadError && <div className="text-xs text-destructive">{uploadError}</div>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {values.map((url, index) => (
          <div className="group relative aspect-square overflow-hidden rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-tertiary)" key={`${url}-${index}`}>
            {accept.includes('video') ? (
              <video className="h-full w-full object-cover" controls playsInline preload="metadata" src={url} />
            ) : (
              <img alt="" className="h-full w-full object-cover" src={url} />
            )}
            <button
              className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition group-hover:opacity-100"
              onClick={() => onChange(values.filter(item => item !== url))}
              type="button"
            >
              移除
            </button>
          </div>
        ))}
        {values.length === 0 && (
          <div className="col-span-full rounded border border-dashed border-(--ui-stroke-secondary) p-4 text-center text-xs text-(--ui-text-secondary)">
            暂未上传素材
          </div>
        )}
      </div>
    </div>
  )
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
  return <textarea {...props} className={cn('min-h-24 w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-3 py-2 text-sm text-(--ui-text-primary) outline-none focus:border-primary', props.className)} />
}

function Select(props: React.ComponentProps<'select'>) {
  return <select {...props} className={cn('h-9 w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-3 text-sm text-(--ui-text-primary) outline-none focus:border-primary', props.className)} />
}

export function DeepSeenRecreationView({ kind }: { kind: RecreationKind }) {
  const [imageMode, setImageMode] = useState<ImageMode>('recreate')
  const [videoMode, setVideoMode] = useState<VideoMode>('recreate')
  const [phase, setPhase] = useState<WorkPhase>('input')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<DeepSeenTaskProgress | null>(null)
  const [taskId, setTaskId] = useState('')
  const [recreationId, setRecreationId] = useState('')
  const [detail, setDetail] = useState<RecreationDetail | null>(null)
  const [history, setHistory] = useState<RecreationDetail[]>([])
  const [productUrl, setProductUrl] = useState('')
  const [productTitle, setProductTitle] = useState('')
  const [sellingPoints, setSellingPoints] = useState('')
  const [region, setRegion] = useState('US')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [imageModel, setImageModel] = useState('nano-banana-2')
  const [videoModel, setVideoModel] = useState('seedance-2.0-zkj-15s')
  const [smartVideoModel, setSmartVideoModel] = useState('SeeDance15s_ZKJ')
  const [duration, setDuration] = useState('15s')
  const [count, setCount] = useState(1)
  const [fallbackConfirming, setFallbackConfirming] = useState(false)
  const [baseImages, setBaseImages] = useState<string[]>([])
  const [referenceVideos, setReferenceVideos] = useState<string[]>([])
  const [realVideos, setRealVideos] = useState<string[]>([])
  const [mixcutSourceId, setMixcutSourceId] = useState('')
  const [preview, setPreview] = useState<ProductPreview | null>(null)

  const activeMode = kind === 'image' ? imageMode : videoMode
  const isBusy = phase === 'analyzing' || phase === 'generating'
  const variants = promptVariants(detail)
  const media = resultMedia(detail, progress, kind)

  const refreshHistory = useCallback(async () => {
    try {
      const query = `recreation/list?limit=12&type=${kind === 'image' ? 'IMAGE' : 'VIDEO'}&mode=RECREATION`
      const data = await deepseenRequest<RecreationListResponse>(query, { timeoutMs: 60_000 })
      setHistory(data.items || [])
    } catch {
      setHistory([])
    }
  }, [kind])

  useEffect(() => {
    setPhase('input')
    setError('')
    setProgress(null)
    setTaskId('')
    setRecreationId('')
    setDetail(null)
    void refreshHistory()
  }, [kind, refreshHistory])

  useEffect(() => {
    if (!taskId || !isBusy) return
    let disposed = false
    const tick = async () => {
      try {
        const next = await getDeepSeenTaskStatus(taskId)
        if (disposed) return
        setProgress(next)
        const status = normalizedStatus(next.status)
        if (status === 'COMPLETED' || status === 'SUCCESS') {
          setPhase(phase === 'analyzing' ? 'confirming' : 'done')
          if (recreationId) {
            try {
              const nextDetail = await deepseenRequest<RecreationDetail>(`recreation/${encodeURIComponent(recreationId)}`)
              if (!disposed) setDetail(nextDetail)
            } catch {
              // Smart creation may already carry the media URLs in task progress.
            }
          }
          void refreshHistory()
          return
        }
        if (status === 'FAILED' || status === 'CANCELLED') {
          setError(next.error || next.message || '任务未完成')
          setPhase('input')
        }
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : '获取任务进度失败')
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 5000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [isBusy, phase, recreationId, refreshHistory, taskId])

  const previewProduct = async () => {
    if (!productUrl.trim()) return
    setError('')
    const data = await deepseenRequest<ProductPreview>('recreation/product-link/preview', {
      body: { productUrl, region },
      timeoutMs: 90_000
    })
    setPreview(data)
    setProductTitle(prev => prev || data.title || '')
    setSellingPoints(prev => prev || (data.sellingPoints || []).join('\n'))
    if (data.images?.length) setBaseImages(data.images.slice(0, 8))
  }

  const startAnalyzeFlow = async () => {
    setError('')
    setDetail(null)
    setProgress(null)
    setPhase('analyzing')
    const effectiveProductUrl = kind === 'video' && referenceVideos[0] ? referenceVideos[0] : productUrl
    if (!effectiveProductUrl.trim()) {
      throw new Error(kind === 'video' ? '请粘贴参考视频链接或上传参考视频' : '请粘贴商品链接')
    }
    const payload: Record<string, unknown> = {
      productUrl: effectiveProductUrl,
      productKeyword: productTitle.trim() || undefined,
      productSellingPoints: sellingPoints.trim() || undefined,
      baseImageUrl: baseImages[0],
      baseImageUrls: baseImages,
      groupCount: count,
      type: kind === 'image' ? 'IMAGE' : 'VIDEO',
      aspectRatio,
      duration: kind === 'video' ? duration : undefined,
      region: kind === 'video' ? region : undefined,
      modelId: kind === 'image' ? imageModel : videoModel,
      modelRiskAccepted: true
    }
    const started = await deepseenRequest<StartTaskResponse>('recreation/analyze', { body: payload, timeoutMs: 120_000 })
    setTaskId(started.taskId)
    if (started.recreationId) {
      setRecreationId(started.recreationId)
      window.setTimeout(() => {
        void deepseenRequest<RecreationDetail>(`recreation/${encodeURIComponent(started.recreationId!)}`).then(setDetail).catch(() => undefined)
      }, 1500)
    }
  }

  const startSmartFlow = async (options: { aiVoiceoverRiskAcknowledged?: boolean; modelRiskAccepted?: boolean } = {}) => {
    setError('')
    setDetail(null)
    setProgress(null)
    setPhase('generating')
    const targetDurationSec = secondsFromDuration(duration)
    const path = kind === 'image' ? 'recreation/smart-image/native' : 'recreation/smart-video/native'
    const body: Record<string, unknown> =
      kind === 'image'
        ? {
            region,
            keywords: productTitle.trim(),
            imageUrls: baseImages,
            modelId: imageModel,
            aspectRatio,
            modelRiskAccepted: Boolean(options.modelRiskAccepted),
            ...(sellingPoints.trim() ? { sellingPoints: sellingPoints.trim() } : {})
          }
        : {
            region,
            referenceImages: baseImages,
            productTitle: productTitle.trim(),
            ...(sellingPoints.trim() ? { sellingPoints: sellingPoints.trim() } : {}),
            count,
            model: smartVideoModel,
            targetDurationSec,
            aiVoiceoverRiskAcknowledged: Boolean(options.aiVoiceoverRiskAcknowledged),
            modelRiskAccepted: Boolean(options.modelRiskAccepted)
          }
    const started = await deepseenRequest<StartTaskResponse>(path, { body, timeoutMs: 300_000 })
    setTaskId(started.taskId)
    if (started.recreationId) setRecreationId(started.recreationId)
  }

  const startMixcutFlow = async () => {
    setError('')
    setDetail(null)
    setProgress(null)
    setPhase('generating')
    const started = await deepseenRequest<StartTaskResponse>('recreation/video-mixcut', {
      body: {
        sourceRecreationId: mixcutSourceId.trim(),
        realVideoUrls: realVideos,
        targetDurationSec: secondsFromDuration(duration),
        minRealRatio: 0.3
      },
      timeoutMs: 120_000
    })
    setTaskId(started.taskId)
    if (started.recreationId) setRecreationId(started.recreationId)
  }

  const confirmGenerate = async () => {
    if (!recreationId) return
    setError('')
    setPhase('generating')
    try {
      const selectedVariantIds = variants.map(variant => variant.id)
      const body: Record<string, unknown> = {
        recreationId,
        modelId: kind === 'image' ? imageModel : videoModel,
        ...(selectedVariantIds.length ? { selectedVariantIds } : {}),
        modelRiskAccepted: true
      }
      if (kind === 'video') {
        body.duration = duration
        body.targetDurationSec = secondsFromDuration(duration)
        body.riskAccepted = true
      }
      const started = await deepseenRequest<StartTaskResponse>('recreation/confirm', { body, timeoutMs: 120_000 })
      setTaskId(started.taskId)
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认生成失败')
      setPhase('confirming')
    }
  }

  const submit = async () => {
    try {
      if (kind === 'video' && videoMode === 'mixcut') {
        await startMixcutFlow()
      } else if (activeMode === 'smart') {
        await startSmartFlow()
      } else {
        await startAnalyzeFlow()
      }
    } catch (err) {
      if (err instanceof DeepSeenApiError && err.code === 'AI_VOICEOVER_RISK_ACK_REQUIRED') {
        setPhase('input')
        if (window.confirm(err.message || '美国市场视频可能包含 AI 配音风险，是否继续生成？')) {
          await startSmartFlow({ aiVoiceoverRiskAcknowledged: true, modelRiskAccepted: true })
        }
        return
      }
      if (err instanceof DeepSeenApiError && err.code === 'MODEL_HIGH_FAILURE_RATE_ACK_REQUIRED') {
        setPhase('input')
        if (window.confirm(err.message || '当前模型失败率偏高，是否继续使用当前模型？')) {
          await startSmartFlow({
            aiVoiceoverRiskAcknowledged: kind === 'video',
            modelRiskAccepted: true
          })
        }
        return
      }
      setError(err instanceof Error ? err.message : '任务启动失败')
      setPhase('input')
    }
  }

  const handleFallbackContinue = async () => {
    const id = progress?.taskId || taskId
    if (!id || fallbackConfirming) return
    setFallbackConfirming(true)
    try {
      await confirmDeepSeenTaskFallback(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认继续生成失败')
    } finally {
      setFallbackConfirming(false)
    }
  }

  const handleCancelTask = async () => {
    const id = progress?.taskId || taskId
    if (!id) return
    try {
      await cancelDeepSeenTask(id)
    } finally {
      setPhase('input')
      setTaskId('')
    }
  }

  const canSubmit = useMemo(() => {
    if (isBusy) return false
    if (kind === 'video' && videoMode === 'mixcut') return Boolean(mixcutSourceId.trim() && realVideos.length)
    if (activeMode === 'smart') return Boolean(productTitle.trim() && baseImages.length)
    const hasSourceUrl = Boolean(productUrl.trim() || (kind === 'video' && referenceVideos[0]))
    return Boolean(productTitle.trim() && baseImages.length && hasSourceUrl)
  }, [activeMode, baseImages.length, isBusy, kind, mixcutSourceId, productTitle, productUrl, realVideos.length, referenceVideos, videoMode])

  const title = kind === 'image' ? '图片复刻' : '视频复刻'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-(--ui-editor-surface-background) pt-(--titlebar-height)">
      <div className="mx-auto w-full max-w-7xl space-y-5 p-5">
        <header className="flex flex-col gap-3 border-b border-(--ui-stroke-secondary) pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold text-primary">DeepSeen 创作工作台</div>
            <h1 className="mt-1 text-2xl font-semibold text-(--ui-text-primary)">{title}</h1>
            <p className="mt-1 text-sm text-(--ui-text-secondary)">
              输入素材后先生成策略和提示词，确认后进入长任务生成。任务进度、日志、预览和下载会在这里完整展示。
            </p>
          </div>
          <Button onClick={() => void refreshHistory()} type="button" variant="outline">
            <Codicon name="refresh" />
            刷新历史
          </Button>
        </header>

        <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
          <main className="space-y-5">
            <section className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
              <div className="flex flex-wrap gap-2">
                {kind === 'image' ? (
                  <>
                    <Button onClick={() => setImageMode('recreate')} type="button" variant={imageMode === 'recreate' ? 'default' : 'outline'}>
                      图片二创
                    </Button>
                    <Button onClick={() => setImageMode('smart')} type="button" variant={imageMode === 'smart' ? 'default' : 'outline'}>
                      图片智创
                    </Button>
                  </>
                ) : (
                  <>
                    <Button onClick={() => setVideoMode('recreate')} type="button" variant={videoMode === 'recreate' ? 'default' : 'outline'}>
                      视频二创
                    </Button>
                    <Button onClick={() => setVideoMode('smart')} type="button" variant={videoMode === 'smart' ? 'default' : 'outline'}>
                      视频智创
                    </Button>
                    <Button onClick={() => setVideoMode('mixcut')} type="button" variant={videoMode === 'mixcut' ? 'default' : 'outline'}>
                      混剪
                    </Button>
                  </>
                )}
              </div>
            </section>

            <section className="grid gap-4 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4 lg:grid-cols-[320px_1fr]">
              <div className="space-y-4">
                {kind === 'video' && activeMode === 'recreate' && (
                  <UploadStrip accept="video/*" disabled={isBusy} label="参考视频（可选）" max={1} onChange={setReferenceVideos} values={referenceVideos} />
                )}
                {kind === 'video' && activeMode === 'mixcut' ? (
                  <UploadStrip accept="video/*" disabled={isBusy} label="实拍素材视频" max={10} onChange={setRealVideos} values={realVideos} />
                ) : (
                  <UploadStrip accept="image/*" disabled={isBusy} label={activeMode === 'smart' ? '产品参考图' : '产品底图'} max={kind === 'image' ? 10 : 9} onChange={setBaseImages} values={baseImages} />
                )}
              </div>

              <div className="space-y-4">
                {activeMode !== 'mixcut' && (
                  <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                    <Field label="商品链接（可选，用于自动提取标题、图片和卖点）">
                      <TextInput disabled={isBusy} onChange={event => setProductUrl(event.target.value)} placeholder="粘贴 TikTok Shop 商品链接" value={productUrl} />
                    </Field>
                    <div className="flex items-end">
                      <Button disabled={!productUrl || isBusy} onClick={() => void previewProduct()} type="button">
                        提取商品信息
                      </Button>
                    </div>
                  </div>
                )}

                {preview && (
                  <div className="rounded border border-primary/30 bg-primary/5 p-3 text-xs text-(--ui-text-secondary)">
                    已提取：{preview.title || '商品'} {preview.price ? ` / ${preview.price}` : ''}
                  </div>
                )}

                {activeMode === 'mixcut' ? (
                  <Field label="来源视频任务 ID">
                    <TextInput disabled={isBusy} onChange={event => setMixcutSourceId(event.target.value)} placeholder="填写已完成的视频智创/二创任务 ID" value={mixcutSourceId} />
                  </Field>
                ) : (
                  <>
                    <Field label="产品名称 / 关键词">
                      <TextInput disabled={isBusy} onChange={event => setProductTitle(event.target.value)} placeholder="例如：美国卷发棒、男士素色 T 恤" value={productTitle} />
                    </Field>
                    <Field label="核心卖点">
                      <TextArea disabled={isBusy} onChange={event => setSellingPoints(event.target.value)} placeholder="每行一个卖点，或从商品链接自动提取" value={sellingPoints} />
                    </Field>
                  </>
                )}

                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="地区">
                    <Select disabled={isBusy} onChange={event => setRegion(event.target.value)} value={region}>
                      <option value="US">美国</option>
                      <option value="GB">英国</option>
                      <option value="EU">欧洲</option>
                      <option value="JP">日本</option>
                    </Select>
                  </Field>
                  <Field label="比例">
                    <Select disabled={isBusy} onChange={event => setAspectRatio(event.target.value)} value={aspectRatio}>
                      <option value="1:1">1:1</option>
                      <option value="4:5">4:5</option>
                      <option value="9:16">9:16</option>
                      <option value="16:9">16:9</option>
                    </Select>
                  </Field>
                  <Field label="模型">
                    {kind === 'image' ? (
                      <Select disabled={isBusy} onChange={event => setImageModel(event.target.value)} value={imageModel}>
                        {IMAGE_MODEL_OPTIONS.map(item => (
                          <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                      </Select>
                    ) : activeMode === 'smart' ? (
                      <Select disabled={isBusy} onChange={event => setSmartVideoModel(event.target.value)} value={smartVideoModel}>
                        {SMART_VIDEO_OPTIONS.map(item => (
                          <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                      </Select>
                    ) : (
                      <Select disabled={isBusy} onChange={event => setVideoModel(event.target.value)} value={videoModel}>
                        {VIDEO_MODEL_OPTIONS.map(item => (
                          <option key={item.id} value={item.id}>{item.label}</option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label={kind === 'image' ? '数量' : '时长/数量'}>
                    {kind === 'image' ? (
                      <TextInput disabled value={activeMode === 'smart' ? '5 张' : '6 张'} />
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <Select disabled={isBusy} onChange={event => setDuration(event.target.value)} value={duration}>
                          <option value="8s">8s</option>
                          <option value="10s">10s</option>
                          <option value="15s">15s</option>
                        </Select>
                        <TextInput disabled={isBusy} max={10} min={1} onChange={event => setCount(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} type="number" value={count} />
                      </div>
                    )}
                  </Field>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <Button disabled={!canSubmit} onClick={() => void submit()} type="button">
                    <Codicon name="play" />
                    {activeMode === 'smart' || activeMode === 'mixcut' ? '开始生成' : '开始分析'}
                  </Button>
                  <Button
                    disabled={isBusy}
                    onClick={() => {
                      setError('')
                      setProgress(null)
                      setDetail(null)
                      setTaskId('')
                      setRecreationId('')
                      setPhase('input')
                    }}
                    type="button"
                    variant="outline"
                  >
                    重置
                  </Button>
                </div>
              </div>
            </section>

            {error && <div className="rounded border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

            {isBusy && (
              <TaskProgressCard
                fallbackConfirming={fallbackConfirming}
                onCancel={() => void handleCancelTask()}
                onFallbackContinue={() => void handleFallbackContinue()}
                phase={phase}
                progress={progress}
              />
            )}

            {phase === 'confirming' && variants.length > 0 && (
              <section className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-(--ui-text-primary)">确认生成方案</h2>
                    <p className="mt-1 text-xs text-(--ui-text-secondary)">DeepSeen 已完成素材分析，请确认提示词后开始正式生成。</p>
                  </div>
                  <Button onClick={() => void confirmGenerate()} type="button">
                    确认并生成
                  </Button>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {variants.map((variant, index) => (
                    <article className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3" key={variant.id}>
                      <div className="mb-2 text-xs font-semibold text-primary">方案 {index + 1}</div>
                      <p className="max-h-36 overflow-auto whitespace-pre-wrap text-xs leading-5 text-(--ui-text-secondary)">{variant.text}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {phase === 'done' && (
              <section className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-(--ui-text-primary)">生成结果</h2>
                  <Button onClick={() => void refreshHistory()} size="xs" type="button" variant="ghost">
                    刷新历史
                  </Button>
                </div>
                {media.length > 0 ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {media.map(item => (
                      <article className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3" key={item.url}>
                        <div className="aspect-video overflow-hidden rounded bg-(--ui-bg-tertiary)">
                          {kind === 'image' ? <img alt={item.label} className="h-full w-full object-contain" src={item.url} /> : <video className="h-full w-full" controls src={item.url} />}
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-(--ui-text-secondary)">{item.label}</span>
                          <Button onClick={() => downloadUrl(item.url)} size="xs" type="button" variant="outline">
                            下载
                          </Button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded border border-dashed border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-4 text-sm text-(--ui-text-secondary)">
                    任务已完成，但当前还没有同步到可预览的图片或视频。请稍后刷新历史；如果仍然为空，说明 DeepSeen 接口没有返回产物 URL。
                  </div>
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
                const outputs = resultMedia(item, null, kind)
                const cover = firstOutputUrl(item, kind) || item.baseImageUrls?.[0] || item.baseImageUrl || ''
                const coverIsOutput = Boolean(outputs[0]?.url && cover === outputs[0].url)
                const status = normalizedStatus(item.status || 'UNKNOWN')
                return (
                  <button
                    className="w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3 text-left hover:border-primary/60"
                    key={item.id}
                    onClick={() => {
                      setDetail(item)
                      setRecreationId(item.id)
                      setPhase(outputs.length ? 'done' : 'confirming')
                    }}
                    type="button"
                  >
                    <div className="space-y-3">
                      <div className="flex gap-3">
                        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-(--ui-bg-tertiary)">
                          {cover ? (
                            kind === 'video' && coverIsOutput ? <video className="h-full w-full object-cover" muted src={cover} /> : <img alt="" className="h-full w-full object-cover" src={cover} />
                          ) : (
                            <Codicon className="text-(--ui-text-tertiary)" name="file-media" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold text-(--ui-text-primary)">{historyTitle(item)}</div>
                          <div className="mt-1 text-[11px] text-(--ui-text-secondary)">
                            {status} / {outputs.length ? `${outputs.length} 个产物` : '暂无产物'}
                          </div>
                        </div>
                      </div>
                      {outputs.length > 1 && (
                        <div className="grid grid-cols-4 gap-1">
                          {outputs.slice(0, 4).map(output => (
                            <div className="aspect-square overflow-hidden rounded bg-(--ui-bg-tertiary)" key={output.url}>
                              {kind === 'video' ? <video className="h-full w-full object-cover" muted src={output.url} /> : <img alt="" className="h-full w-full object-cover" src={output.url} />}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
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
