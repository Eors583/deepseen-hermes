import type * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  cancelDeepSeenTask,
  confirmDeepSeenTaskFallback,
  DeepSeenApiError,
  deepseenRequest,
  streamDeepSeenTask,
  type DeepSeenTaskProgress,
  uploadDeepSeenDataUrl,
  uploadDeepSeenFile
} from '@/hermes'
import { cn } from '@/lib/utils'

type RecreationKind = 'image' | 'video'
type ImageMode = 'recreate' | 'smart' | 'original'
type VideoMode = 'recreate' | 'smart' | 'mixcut'
type WorkPhase = 'input' | 'analyzing' | 'confirming' | 'generating' | 'done'
type ProductMaterialSource = 'upload' | 'link'
type VideoInputMode = 'link' | 'upload'

interface RecreationDetail {
  baseImageUrl?: string
  baseImageUrls?: string[]
  createdAt?: string
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
  prompt?: string
  referenceImage?: string
  url: string
  variantId?: string
}

interface KnowledgeItem {
  id: string
  market?: string | null
  productName?: string | null
  summary?: string | null
  title: string
  type: string
}

interface KnowledgeResponse {
  items?: KnowledgeItem[]
}

interface ViralDnaOption {
  id: string
  market?: string
  productName?: string
  summary?: string
  targetDurationSec?: number
  title?: string
}

interface MixcutSource {
  id: string
  label: string
  previewUrls?: string[]
  selectedVideoIds?: string[]
}

interface PromptVariant {
  displayPromptZh?: string
  id: string
  prompt?: string
  promptEn?: string
  promptZh?: string
  referenceImage?: string
  strategy?: string
  text: string
  videoPrompt?: string
  videoPromptZh?: string
}

interface ModelRisk {
  level?: 'PASS' | 'CAUTION' | 'WARN'
  message?: string
  reasons?: string[]
  requiresUserDecision?: boolean
  suggestions?: string[]
  title?: string
}

const IMAGE_MODEL_OPTIONS = [
  { id: 'nano-banana-2', label: 'Nano Banana 2' },
  { id: 'gpt-image-1', label: 'GPT Image' }
]

const VIDEO_MODEL_OPTIONS = [
  { id: 'seedance-2.0-zkj-15s', label: 'Seedance2.0_ZKJ - 15s', seconds: 15 },
  { id: 'veo-3.1-stable', label: 'VEO 3.1 稳定版 - 8s', seconds: 8 },
  { id: 'veo-3.1-lite', label: 'VEO 3.1 Lite', seconds: 8 },
  { id: 'grok-video-10s', label: 'Grok Video - 10s', seconds: 10 }
]

const SMART_VIDEO_OPTIONS = [
  { id: 'SeeDance15s_ZKJ', internalId: 'seedance-2.0-zkj-15s', label: 'Seedance2.0_ZKJ - 15s', seconds: 15 },
  { id: 'Veo8s', internalId: 'veo-3.1-stable', label: 'VEO 3.1 稳定版 - 8s', seconds: 8 },
  { id: 'GeminiOmni10s', internalId: 'Gemini Omni Video', label: 'Gemini Omni - 10s', seconds: 10 },
  { id: 'Grok1_5', internalId: 'grok-imagine-video-1-5-preview', label: 'Grok 1.5 - 15s', seconds: 15 }
]

const IMAGE_ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const
const RECREATE_ASPECT_RATIOS = ['1:1', '4:5', '9:16', '16:9'] as const
const IMAGE_REFERENCE_IMAGE_LIMIT = 5
const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_UPLOAD_BYTES = 300 * 1024 * 1024
const RECREATE_VIDEO_UPLOAD_BYTES = 15 * 1024 * 1024
const SMART_IMAGE_OUTPUT_COUNT = 6
const IMAGE_RECREATE_OUTPUT_COUNT = 6
const MAX_REAL_VIDEOS = 5
const VIDEO_KNOWLEDGE_TYPES = new Set(['VIRAL_VIDEO_DNA', 'AD_MATERIAL_DNA'])
const SELLING_POINT_HINT_TAGS = ['卖点1', '卖点2', '卖点3'] as const
const US_REGION_VALUES = new Set(['US', 'USA', 'UNITED STATES', '美国', '美区'])

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

function secondsFromDuration(value: string | number): number {
  const seconds = typeof value === 'number' ? value : Number.parseInt(value, 10)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 15
}

function durationLabel(seconds: number): string {
  return `${seconds}s`
}

function getSingleClipDurationSeconds(modelId: string): number {
  return SMART_VIDEO_OPTIONS.find(item => item.id === modelId || item.internalId === modelId)?.seconds || 10
}

function getVideoReferenceImageLimit(modelId: string): number {
  if (modelId === 'Gemini Omni Video' || modelId === 'GeminiOmni10s') return 7
  if (modelId === 'veo-3.1-stable' || modelId === 'Veo8s_official') return 3
  if (modelId === 'veo-3.1-experience' || modelId === 'Veo8s') return 3
  if (String(modelId || '').startsWith('seedance') || modelId === 'SeeDance15s' || modelId === 'SeeDance15s_ZKJ') return 9
  if (modelId === 'grok-imagine-video-1-5-preview' || modelId === 'Grok1_5' || modelId === 'grok-video-10s' || modelId === 'grok-video-20s') return 7
  if (modelId === 'ltx-2.3-10s') return 1
  return 10
}

function getModelCallCount(modelId: string, targetDurationSec: number): number {
  return Math.max(1, Math.ceil(Math.max(1, targetDurationSec) / getSingleClipDurationSeconds(modelId)))
}

function isUsRegion(region: string): boolean {
  const normalized = String(region || '').trim()
  return US_REGION_VALUES.has(normalized) || US_REGION_VALUES.has(normalized.toUpperCase())
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

function promptVariantRecords(detail: RecreationDetail | null): Record<string, unknown>[] {
  const variants = detail?.promptData?.prompt_variants
  return Array.isArray(variants) ? variants.filter(isRecord) : []
}

function parsePromptVariants(detail: RecreationDetail | null): PromptVariant[] {
  return promptVariantRecords(detail)
    .map((item, index) => {
      const id = String(item.variant_id || item.id || `variant-${index + 1}`)
      const text = item.displayPromptZh || item.promptZh || item.videoPromptZh || item.prompt || item.videoPrompt || ''
      return {
        displayPromptZh: typeof item.displayPromptZh === 'string' ? item.displayPromptZh : undefined,
        id,
        prompt: typeof item.prompt === 'string' ? item.prompt : undefined,
        promptEn: typeof item.promptEn === 'string' ? item.promptEn : undefined,
        promptZh: typeof item.promptZh === 'string' ? item.promptZh : undefined,
        referenceImage: typeof item.reference_image === 'string' ? item.reference_image : undefined,
        strategy: typeof item.strategy === 'string' ? item.strategy : undefined,
        text: typeof text === 'string' ? text : JSON.stringify(text ?? '', null, 2),
        videoPrompt: typeof item.videoPrompt === 'string' ? item.videoPrompt : undefined,
        videoPromptZh: typeof item.videoPromptZh === 'string' ? item.videoPromptZh : undefined
      }
    })
    .filter(item => Boolean(item.text))
}

function resultMedia(detail: RecreationDetail | null, progress: DeepSeenTaskProgress | null, kind: RecreationKind): MediaItem[] {
  const key = kind === 'image' ? 'resultImages' : 'resultVideos'
  const maps = [
    ...collectMediaMaps(detail, key),
    ...collectMediaMaps(progress, key),
    ...collectMediaMaps(progress?.result, key)
  ]
  const variants = parsePromptVariants(detail)
  const seen = new Set<string>()
  return maps
    .flatMap(map =>
      Object.entries(map)
        .filter(([, url]) => typeof url === 'string' && Boolean(url))
        .map(([variantId, url]) => {
          const parentId = variantId.replace(/_clip\d+$/, '')
          const variant = variants.find(item => item.id === variantId || item.id === parentId)
          return {
            label: variant?.strategy || variantId,
            prompt: variant?.videoPromptZh || variant?.promptZh || variant?.text,
            referenceImage: variant?.referenceImage,
            url: String(url),
            variantId
          }
        })
    )
    .filter(item => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
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
  maxBytes,
  onChange,
  values
}: {
  accept: string
  disabled?: boolean
  label: string
  max: number
  maxBytes?: number
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
      const limit = maxBytes || (accept.includes('video') ? MAX_VIDEO_UPLOAD_BYTES : MAX_IMAGE_UPLOAD_BYTES)
      for (const file of Array.from(files).slice(0, Math.max(0, max - values.length))) {
        if (file.size > limit) {
          const limitMb = Math.round(limit / 1024 / 1024)
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

function compactItemLabel(item: KnowledgeItem | ViralDnaOption): string {
  return item.title || item.productName || item.summary || item.id
}

export function DeepSeenRecreationView({ kind }: { kind: RecreationKind }) {
  const [imageMode, setImageMode] = useState<ImageMode>('recreate')
  const [videoMode, setVideoMode] = useState<VideoMode>('smart')
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
  const [originalScript, setOriginalScript] = useState('')
  const [originalEnhancePrompt, setOriginalEnhancePrompt] = useState(false)
  const [originalCount, setOriginalCount] = useState(1)
  const [region, setRegion] = useState('美国')
  const [aspectRatio, setAspectRatio] = useState('9:16')
  const [imageModel, setImageModel] = useState('nano-banana-2')
  const [videoModel, setVideoModel] = useState('seedance-2.0-zkj-15s')
  const [smartVideoModel, setSmartVideoModel] = useState('SeeDance15s_ZKJ')
  const [videoInputMode, setVideoInputMode] = useState<VideoInputMode>('link')
  const [duration, setDuration] = useState('15s')
  const [targetDurationSec, setTargetDurationSec] = useState(15)
  const [minRealRatio, setMinRealRatio] = useState(0.3)
  const [count, setCount] = useState(1)
  const [fallbackConfirming, setFallbackConfirming] = useState(false)
  const [baseImages, setBaseImages] = useState<string[]>([])
  const [referenceVideos, setReferenceVideos] = useState<string[]>([])
  const [realVideos, setRealVideos] = useState<string[]>([])
  const [productMaterialSource, setProductMaterialSource] = useState<ProductMaterialSource>('upload')
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([])
  const [knowledgeReferenceIds, setKnowledgeReferenceIds] = useState<string[]>([])
  const [viralDnaOptions, setViralDnaOptions] = useState<ViralDnaOption[]>([])
  const [selectedViralDnaId, setSelectedViralDnaId] = useState('')
  const [viralDnaLoading, setViralDnaLoading] = useState(false)
  const [mixcutSource, setMixcutSource] = useState<MixcutSource | null>(null)
  const [mixcutCandidates, setMixcutCandidates] = useState<RecreationDetail[]>([])
  const [sourcePickerSelectedId, setSourcePickerSelectedId] = useState('')
  const [sourcePickerSelectedVideoIds, setSourcePickerSelectedVideoIds] = useState<string[]>([])
  const [editedPrompts, setEditedPrompts] = useState<Record<string, string>>({})
  const [dynamicClipMode, setDynamicClipMode] = useState<'recommended' | 'compress' | ''>('')
  const [preview, setPreview] = useState<ProductPreview | null>(null)

  const activeMode = kind === 'image' ? imageMode : videoMode
  const isBusy = phase === 'analyzing' || phase === 'generating'
  const variants = parsePromptVariants(detail)
  const media = resultMedia(detail, progress, kind)
  const modelRisk = (isRecord(detail?.promptData?.modelRisk) ? detail?.promptData?.modelRisk : null) as ModelRisk | null
  const dynamicClipPlan = isRecord(detail?.promptData?.dynamicClipPlan) ? detail?.promptData?.dynamicClipPlan : null
  const videoKnowledgeItems = knowledgeItems.filter(item => VIDEO_KNOWLEDGE_TYPES.has(item.type))
  const selectedSmartModel = SMART_VIDEO_OPTIONS.find(item => item.id === smartVideoModel) || SMART_VIDEO_OPTIONS[0]
  const smartReferenceImageLimit = kind === 'video' ? getVideoReferenceImageLimit(selectedSmartModel.internalId) : IMAGE_REFERENCE_IMAGE_LIMIT

  const refreshHistory = useCallback(async () => {
    try {
      const mode = kind === 'image' && imageMode === 'original' ? 'ORIGINAL' : 'RECREATION'
      const query = `recreation/list?limit=12&type=${kind === 'image' ? 'IMAGE' : 'VIDEO'}&mode=${mode}`
      const data = await deepseenRequest<RecreationListResponse>(query, { timeoutMs: 60_000 })
      setHistory(data.items || [])
    } catch {
      setHistory([])
    }
  }, [imageMode, kind])

  const loadKnowledgeItems = useCallback(async () => {
    try {
      const data = await deepseenRequest<KnowledgeResponse>('knowledge?active=true&limit=30', { timeoutMs: 60_000 })
      setKnowledgeItems(data.items || [])
    } catch {
      setKnowledgeItems([])
    }
  }, [])

  const loadMixcutCandidates = useCallback(async () => {
    try {
      const data = await deepseenRequest<RecreationListResponse>('recreation/list?limit=20&type=VIDEO&mode=RECREATION', { timeoutMs: 60_000 })
      setMixcutCandidates(data.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载历史视频失败')
    }
  }, [])

  useEffect(() => {
    setPhase('input')
    setError('')
    setProgress(null)
    setTaskId('')
    setRecreationId('')
    setDetail(null)
    setEditedPrompts({})
    void refreshHistory()
    void loadKnowledgeItems()
    if (kind === 'video') void loadMixcutCandidates()
  }, [kind, loadKnowledgeItems, loadMixcutCandidates, refreshHistory])

  useEffect(() => {
    if (!taskId || !isBusy) return
    let disposed = false
    const finishTask = async (next: DeepSeenTaskProgress) => {
      try {
        if (disposed) return
        setProgress(next)
        const status = normalizedStatus(next.status)
        if (status === 'COMPLETED' || status === 'SUCCESS') {
          if (phase === 'analyzing') {
            const rId = String(next.result?.recreationId || recreationId || '')
            if (rId) {
              const nextDetail = await deepseenRequest<RecreationDetail>(`recreation/${encodeURIComponent(rId)}`)
              if (!disposed) {
                setDetail(nextDetail)
                setRecreationId(rId)
                setPhase('confirming')
              }
            } else {
              setPhase('confirming')
            }
          } else {
            const rId = String(next.result?.recreationId || recreationId || '')
            if (rId) {
              try {
                const nextDetail = await deepseenRequest<RecreationDetail>(`recreation/${encodeURIComponent(rId)}`)
                if (!disposed) setDetail(nextDetail)
              } catch {
                // Smart creation can carry media URLs in task progress.
              }
            }
            setPhase('done')
          }
          void refreshHistory()
          return
        }
        if (status === 'FAILED' || status === 'CANCELLED') {
          setError(next.error || next.message || '任务未完成')
          setPhase('input')
          void refreshHistory()
        }
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : '获取任务进度失败')
      }
    }
    const cleanup = streamDeepSeenTask(taskId, {
      onProgress: next => {
        if (!disposed) setProgress(next)
      },
      onComplete: next => {
        void finishTask(next)
      },
      onError: err => {
        if (!disposed) setError(err.message || '鑾峰彇浠诲姟杩涘害澶辫触')
      }
    })
    return () => {
      disposed = true
      cleanup()
    }
  }, [isBusy, phase, recreationId, refreshHistory, taskId])

  useEffect(() => {
    const seconds = getSingleClipDurationSeconds(smartVideoModel)
    if (targetDurationSec < seconds) setTargetDurationSec(seconds)
  }, [smartVideoModel, targetDurationSec])

  useEffect(() => {
    if (kind === 'image' && activeMode === 'smart' && baseImages.length > IMAGE_REFERENCE_IMAGE_LIMIT) {
      setBaseImages(prev => prev.slice(0, IMAGE_REFERENCE_IMAGE_LIMIT))
    }
    if (kind === 'video' && activeMode === 'smart' && baseImages.length > smartReferenceImageLimit) {
      setBaseImages(prev => prev.slice(0, smartReferenceImageLimit))
    }
  }, [activeMode, baseImages.length, kind, smartReferenceImageLimit])

  useEffect(() => {
    if (realVideos.length > MAX_REAL_VIDEOS) setRealVideos(prev => prev.slice(0, MAX_REAL_VIDEOS))
  }, [realVideos.length])

  const previewProduct = async () => {
    if (!productUrl.trim()) return
    setError('')
    const data = await deepseenRequest<ProductPreview>('recreation/product-link/preview', {
      body: { productUrl, region },
      timeoutMs: 90_000
    })
    setPreview(data)
    setProductTitle(prev => data.title || prev)
    setSellingPoints(prev => (data.sellingPoints?.length ? data.sellingPoints.join('\n') : prev))
    if (data.images?.length) setBaseImages(data.images.slice(0, kind === 'video' ? smartReferenceImageLimit : IMAGE_REFERENCE_IMAGE_LIMIT))
  }

  const loadViralDnaOptions = async () => {
    if (!productTitle.trim()) {
      setError('请先填写产品标题')
      return
    }
    setViralDnaLoading(true)
    setError('')
    try {
      const query = new URLSearchParams({
        limit: '10',
        productName: productTitle.trim(),
        region
      })
      const items = await deepseenRequest<ViralDnaOption[]>(`viral-dna/reference-options?${query.toString()}`, { timeoutMs: 60_000 })
      setViralDnaOptions(items || [])
      const nextId = items?.[0]?.id || ''
      setSelectedViralDnaId(nextId)
      if (nextId) setKnowledgeReferenceIds([])
      const suggested = Number(items?.[0]?.targetDurationSec || 0)
      if (suggested > 0) setTargetDurationSec(suggested)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载爆款 DNA 失败')
    } finally {
      setViralDnaLoading(false)
    }
  }

  const startAnalyzeFlow = async (options: { modelRiskAccepted?: boolean } = {}) => {
    setError('')
    setDetail(null)
    setProgress(null)
    setEditedPrompts({})
    setPhase('analyzing')
    const effectiveProductUrl = kind === 'video' && videoInputMode === 'upload' && referenceVideos[0] ? referenceVideos[0] : productUrl
    if (!effectiveProductUrl.trim()) {
      throw new Error(kind === 'video' ? '请输入视频链接或上传参考视频' : '请输入商品链接')
    }
    const payload: Record<string, unknown> = {
      productUrl: effectiveProductUrl,
      productKeyword: productTitle.trim() || undefined,
      productSellingPoints: sellingPoints.trim() || undefined,
      baseImageUrl: baseImages[0],
      baseImageUrls: baseImages,
      groupCount: kind === 'image' ? IMAGE_RECREATE_OUTPUT_COUNT : count,
      type: kind === 'image' ? 'IMAGE' : 'VIDEO',
      aspectRatio,
      duration: kind === 'video' ? duration : undefined,
      region: kind === 'video' ? region : undefined,
      modelId: kind === 'image' ? imageModel : videoModel,
      modelRiskAccepted: Boolean(options.modelRiskAccepted)
    }
    const started = await deepseenRequest<StartTaskResponse>('recreation/analyze', { body: payload, timeoutMs: 120_000 })
    setTaskId(started.taskId)
    if (started.recreationId) setRecreationId(started.recreationId)
  }

  const startSmartFlow = async (options: { aiVoiceoverRiskAcknowledged?: boolean; modelRiskAccepted?: boolean } = {}) => {
    setError('')
    setDetail(null)
    setProgress(null)
    setPhase('generating')
    let effectiveTargetDurationSec = targetDurationSec
    if (kind === 'video') {
      const singleClipSeconds = getSingleClipDurationSeconds(selectedSmartModel.internalId)
      const callCount = getModelCallCount(selectedSmartModel.internalId, targetDurationSec)
      if (callCount > 1) {
        const ok = window.confirm(`系统将按 ${targetDurationSec}s 生成。当前模型单次 ${singleClipSeconds}s；按建议方案每条需要调用 ${callCount} 次。点击“确定”按 ${targetDurationSec}s 生成，点击“取消”压缩成 ${singleClipSeconds}s。`)
        effectiveTargetDurationSec = ok ? targetDurationSec : singleClipSeconds
      }
    }
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
            ...(sellingPoints.trim() ? { sellingPoints: sellingPoints.trim() } : {}),
            ...(knowledgeReferenceIds.length ? { knowledgeReferenceIds } : {})
          }
        : {
            region,
            referenceImages: baseImages,
            productTitle: productTitle.trim(),
            ...(sellingPoints.trim() ? { sellingPoints: sellingPoints.trim() } : {}),
            count,
            model: smartVideoModel,
            targetDurationSec: effectiveTargetDurationSec,
            ...(selectedViralDnaId ? { viralDnaAnalysisId: selectedViralDnaId } : {}),
            ...(knowledgeReferenceIds.length ? { knowledgeReferenceIds } : {}),
            aiVoiceoverRiskAcknowledged: Boolean(options.aiVoiceoverRiskAcknowledged),
            modelRiskAccepted: Boolean(options.modelRiskAccepted)
          }
    const started = await deepseenRequest<StartTaskResponse>(path, { body, timeoutMs: 300_000 })
    setTaskId(started.taskId)
    if (started.recreationId) {
      setRecreationId(started.recreationId)
      if (kind === 'video') {
        setMixcutSource({ id: started.recreationId, label: productTitle.trim() || started.recreationId })
      }
    }
  }

  const startOriginalImageFlow = async (options: { modelRiskAccepted?: boolean } = {}) => {
    if (!originalScript.trim()) {
      throw new Error('请输入原创脚本或创意描述')
    }
    setError('')
    setDetail(null)
    setProgress(null)
    setPhase('generating')
    const started = await deepseenRequest<StartTaskResponse>('recreation/original', {
      body: {
        mode: 'SCRIPT',
        baseImageUrl: baseImages[0],
        baseImageUrls: baseImages,
        fullScript: originalScript.trim(),
        count: originalCount,
        aspectRatio,
        enhancePrompt: originalEnhancePrompt,
        modelId: imageModel,
        modelRiskAccepted: Boolean(options.modelRiskAccepted)
      },
      timeoutMs: 300_000
    })
    setTaskId(started.taskId)
    if (started.recreationId) setRecreationId(started.recreationId)
  }

  const startMixcutFlow = async () => {
    setError('')
    setDetail(null)
    setProgress(null)
    setPhase('generating')
    if (!mixcutSource?.id) throw new Error('请选择一个已完成的视频智创结果')
    const started = await deepseenRequest<StartTaskResponse>('recreation/video-mixcut', {
      body: {
        sourceRecreationId: mixcutSource.id,
        ...(mixcutSource.selectedVideoIds?.length ? { selectedVideoIds: mixcutSource.selectedVideoIds } : {}),
        realVideoUrls: realVideos,
        targetDurationSec,
        minRealRatio
      },
      timeoutMs: 120_000
    })
    setTaskId(started.taskId)
    if (started.recreationId) setRecreationId(started.recreationId)
  }

  const confirmGenerate = async (options: { modelRiskAccepted?: boolean } = {}) => {
    if (!recreationId) return
    setError('')
    setPhase('generating')
    try {
      const editedVariants = variants
        .filter(variant => {
          const next = editedPrompts[variant.id]
          return next !== undefined && next.trim().length > 0 && next !== variant.text
        })
        .map(variant => ({ prompt: editedPrompts[variant.id], promptLanguage: 'zh' as const, variant_id: variant.id }))
      const body: Record<string, unknown> = {
        recreationId,
        modelId: kind === 'image' ? imageModel : videoModel,
        ...(editedVariants.length ? { editedVariants } : {}),
        ...(dynamicClipMode ? { dynamicClipMode } : {}),
        ...(modelRisk?.level === 'WARN' ? { riskAccepted: true } : {}),
        modelRiskAccepted: Boolean(options.modelRiskAccepted)
      }
      const started = await deepseenRequest<StartTaskResponse>('recreation/confirm', { body, timeoutMs: 120_000 })
      setTaskId(started.taskId)
    } catch (err) {
      if (err instanceof DeepSeenApiError && err.code === 'MODEL_HIGH_FAILURE_RATE_ACK_REQUIRED') {
        if (window.confirm(err.message || '当前模型失败率偏高，是否继续使用当前模型？')) {
          await confirmGenerate({ modelRiskAccepted: true })
        }
        return
      }
      setError(err instanceof Error ? err.message : '确认生成失败')
      setPhase('confirming')
    }
  }

  const submit = async () => {
    try {
      if (kind === 'image' && imageMode === 'original') {
        await startOriginalImageFlow()
      } else if (kind === 'video' && videoMode === 'mixcut') {
        await startMixcutFlow()
      } else if (activeMode === 'smart') {
        if (kind === 'video' && isUsRegion(region)) {
          const ok = window.confirm('美国市场视频可能包含 AI 配音风险，是否继续生成？')
          if (!ok) return
          await startSmartFlow({ aiVoiceoverRiskAcknowledged: true })
        } else {
          await startSmartFlow()
        }
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
          if (kind === 'image' && imageMode === 'original') {
            await startOriginalImageFlow({ modelRiskAccepted: true })
          } else if (activeMode === 'smart') {
            await startSmartFlow({
              aiVoiceoverRiskAcknowledged: kind === 'video',
              modelRiskAccepted: true
            })
          } else {
            await startAnalyzeFlow({ modelRiskAccepted: true })
          }
        }
        return
      }
      setError(err instanceof Error ? err.message : '任务启动失败')
      setPhase('input')
    }
  }

  const resetFlow = () => {
    setPhase('input')
    setError('')
    setProgress(null)
    setTaskId('')
    setRecreationId('')
    setDetail(null)
    setEditedPrompts({})
    setFallbackConfirming(false)
  }

  const cancelRecreation = async () => {
    if (recreationId) {
      try {
        await deepseenRequest(`recreation/${encodeURIComponent(recreationId)}/cancel`, {
          body: {},
          method: 'POST',
          timeoutMs: 60_000
        })
      } catch {
        // Keep the local reset path available even if the remote cancel already completed.
      }
    }
    resetFlow()
    void refreshHistory()
  }

  const stopRiskRecreation = async () => {
    if (!recreationId) return
    try {
      await deepseenRequest(`recreation/${encodeURIComponent(recreationId)}/stop-risk`, {
        body: {},
        method: 'POST',
        timeoutMs: 60_000
      })
      resetFlow()
      void refreshHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : '停止任务失败')
    }
  }

  const copyPrompt = async (text: string) => {
    try {
      await window.hermesDesktop.writeClipboard(text)
    } catch {
      await navigator.clipboard.writeText(text)
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
      setFallbackConfirming(false)
    }
  }

  const mixcutVideoOptions = useMemo(() => {
    return mixcutCandidates.flatMap(item => {
      const source = String(item.scriptData?.source || item.promptData?.source || '')
      const isSmartVideo = source === 'SMART_VIDEO_RECREATE' || source === 'SMART_VIDEO_RECREATE_NATIVE' || Boolean(item.resultVideos)
      if (normalizedStatus(item.status) !== 'COMPLETED' || !isSmartVideo || !item.resultVideos) return []
      const label = historyTitle(item)
      return Object.entries(item.resultVideos)
        .filter(([variantId, url]) => !/_clip\d+$/.test(variantId) && typeof url === 'string' && Boolean(url))
        .map(([variantId, url]) => ({
          createdAt: item.createdAt,
          label,
          sourceId: item.id,
          url,
          variantId
        }))
    })
  }, [mixcutCandidates])

  const confirmSourcePicker = () => {
    if (!sourcePickerSelectedId || sourcePickerSelectedVideoIds.length === 0) {
      setError('请至少选择 1 条 AI 视频')
      return
    }
    const selected = mixcutVideoOptions.filter(item => item.sourceId === sourcePickerSelectedId && sourcePickerSelectedVideoIds.includes(item.variantId))
    const first = selected[0]
    setMixcutSource({
      id: sourcePickerSelectedId,
      label: first ? `${first.label} / ${sourcePickerSelectedVideoIds.join('/')}` : sourcePickerSelectedId,
      previewUrls: selected.map(item => item.url),
      selectedVideoIds: sourcePickerSelectedVideoIds
    })
  }

  const canSubmit = useMemo(() => {
    if (isBusy) return false
    if (kind === 'image' && imageMode === 'original') return Boolean(originalScript.trim())
    if (kind === 'video' && videoMode === 'mixcut') return Boolean(mixcutSource?.id && realVideos.length)
    if (activeMode === 'smart') return Boolean(productTitle.trim() && baseImages.length)
    const hasSourceUrl = Boolean(productUrl.trim() || (kind === 'video' && videoInputMode === 'upload' && referenceVideos[0]))
    return Boolean(productTitle.trim() && baseImages.length && hasSourceUrl)
  }, [activeMode, baseImages.length, imageMode, isBusy, kind, mixcutSource?.id, originalScript, productTitle, productUrl, realVideos.length, referenceVideos, videoInputMode, videoMode])

  const title = kind === 'image' ? '图片创作' : '视频创作'
  const aspectOptions = activeMode === 'recreate' ? RECREATE_ASPECT_RATIOS : IMAGE_ASPECT_RATIOS

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-(--ui-editor-surface-background) pt-(--titlebar-height)">
      <div className="mx-auto w-full max-w-7xl space-y-5 p-5">
        <header className="flex flex-col gap-3 border-b border-(--ui-stroke-secondary) pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold text-primary">DeepSeen 创作工作台</div>
            <h1 className="mt-1 text-2xl font-semibold text-(--ui-text-primary)">{title}</h1>
            <p className="mt-1 text-sm text-(--ui-text-secondary)">
              已按 DeepSeen Web 的图片智创、视频智创、实拍混剪和二创流程接入输入项、任务进度、确认分支和产物回显。
            </p>
          </div>
          <Button onClick={() => void refreshHistory()} type="button" variant="outline">
            <Codicon name="refresh" />
            刷新历史
          </Button>
        </header>

        <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
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
                    <Button onClick={() => setImageMode('original')} type="button" variant={imageMode === 'original' ? 'default' : 'outline'}>
                      图片原创
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
                      实拍混剪
                    </Button>
                  </>
                )}
              </div>
            </section>

            <section className="grid gap-4 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4 lg:grid-cols-[320px_1fr]">
              <div className="space-y-4">
                {kind === 'video' && activeMode === 'mixcut' ? (
                  <UploadStrip accept="video/*" disabled={isBusy} label="实拍素材视频" max={MAX_REAL_VIDEOS} onChange={setRealVideos} values={realVideos} />
                ) : (
                  <>
                    {kind === 'video' && activeMode === 'smart' && (
                      <div className="flex rounded border border-(--ui-stroke-secondary) p-1 text-xs">
                        <button
                          className={cn('flex-1 rounded px-2 py-1', productMaterialSource === 'upload' && 'bg-primary text-primary-foreground')}
                          onClick={() => {
                            if (productMaterialSource !== 'upload') {
                              setProductMaterialSource('upload')
                              setBaseImages([])
                            }
                          }}
                          type="button"
                        >
                          上传产品图
                        </button>
                        <button
                          className={cn('flex-1 rounded px-2 py-1', productMaterialSource === 'link' && 'bg-primary text-primary-foreground')}
                          onClick={() => {
                            if (productMaterialSource !== 'link') {
                              setProductMaterialSource('link')
                              setBaseImages([])
                            }
                          }}
                          type="button"
                        >
                          商品链接导入
                        </button>
                      </div>
                    )}
                    {kind === 'video' && activeMode === 'smart' && productMaterialSource === 'link' ? (
                      <div className="space-y-3">
                        <Field label="商品链接">
                          <TextInput disabled={isBusy} onChange={event => setProductUrl(event.target.value)} placeholder="粘贴 TikTok Shop 商品链接" value={productUrl} />
                        </Field>
                        <Button disabled={!productUrl || isBusy} onClick={() => void previewProduct()} type="button">
                          提取商品信息
                        </Button>
                        {baseImages.length > 0 && <UploadStrip accept="image/*" disabled={isBusy} label="已提取/可补充参考图" max={smartReferenceImageLimit} onChange={setBaseImages} values={baseImages} />}
                      </div>
                    ) : (
                      <UploadStrip
                        accept="image/*"
                        disabled={isBusy}
                        label={activeMode === 'smart' ? (kind === 'image' ? '自有产品图' : '产品参考图') : '产品底图'}
                        max={activeMode === 'smart' ? (kind === 'image' ? IMAGE_REFERENCE_IMAGE_LIMIT : smartReferenceImageLimit) : (kind === 'image' ? 10 : 9)}
                        onChange={setBaseImages}
                        values={baseImages}
                      />
                    )}
                  </>
                )}
              </div>

              <div className="space-y-4">
                {activeMode === 'recreate' && (
                  kind === 'video' ? (
                    <div className="space-y-3">
                      <div className="flex rounded border border-(--ui-stroke-secondary) p-1 text-xs">
                        <button
                          className={cn('flex-1 rounded px-2 py-1', videoInputMode === 'link' && 'bg-primary text-primary-foreground')}
                          disabled={isBusy}
                          onClick={() => {
                            setVideoInputMode('link')
                            setReferenceVideos([])
                            setProductUrl('')
                          }}
                          type="button"
                        >
                          粘贴链接
                        </button>
                        <button
                          className={cn('flex-1 rounded px-2 py-1', videoInputMode === 'upload' && 'bg-primary text-primary-foreground')}
                          disabled={isBusy}
                          onClick={() => {
                            setVideoInputMode('upload')
                            setProductUrl('')
                          }}
                          type="button"
                        >
                          上传视频
                        </button>
                      </div>
                      {videoInputMode === 'upload' ? (
                        <UploadStrip accept="video/mp4,video/quicktime,video/webm" disabled={isBusy} label="参考视频（15MB 内）" max={1} maxBytes={RECREATE_VIDEO_UPLOAD_BYTES} onChange={setReferenceVideos} values={referenceVideos} />
                      ) : (
                        <Field label="视频链接">
                          <TextArea disabled={isBusy} onChange={event => setProductUrl(event.target.value)} placeholder="粘贴 TikTok 爆款视频链接" value={productUrl} />
                        </Field>
                      )}
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                      <Field label="商品链接">
                        <TextInput disabled={isBusy} onChange={event => setProductUrl(event.target.value)} placeholder="粘贴 TikTok Shop 商品链接 / 描述" value={productUrl} />
                      </Field>
                      <div className="flex items-end">
                        <Button disabled={!productUrl || isBusy} onClick={() => void previewProduct()} type="button">
                          提取商品信息
                        </Button>
                      </div>
                    </div>
                  )
                )}

                {preview && (
                  <div className="rounded border border-primary/30 bg-primary/5 p-3 text-xs text-(--ui-text-secondary)">
                    已提取：{preview.title || '商品'} {preview.price ? ` / ${preview.price}` : ''}
                  </div>
                )}

                {activeMode === 'mixcut' ? (
                  <div className="space-y-4">
                    <div className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold text-(--ui-text-primary)">引用的视频智创结果</div>
                          <div className="mt-1 text-xs text-(--ui-text-secondary)">{mixcutSource?.label || '未选择'}</div>
                        </div>
                        <Button onClick={() => void loadMixcutCandidates()} size="xs" type="button" variant="outline">
                          刷新
                        </Button>
                      </div>
                      <div className="mt-3 max-h-60 space-y-2 overflow-auto">
                        {mixcutVideoOptions.length === 0 ? (
                          <div className="text-xs text-(--ui-text-secondary)">暂无可用的已完成视频智创结果</div>
                        ) : (
                          mixcutVideoOptions.map(option => {
                            const checked = sourcePickerSelectedId === option.sourceId && sourcePickerSelectedVideoIds.includes(option.variantId)
                            return (
                              <label className="flex cursor-pointer items-start gap-2 rounded border border-(--ui-stroke-secondary) p-2 text-xs" key={`${option.sourceId}-${option.variantId}`}>
                                <input
                                  checked={checked}
                                  onChange={() => {
                                    if (sourcePickerSelectedId && sourcePickerSelectedId !== option.sourceId) {
                                      setSourcePickerSelectedId(option.sourceId)
                                      setSourcePickerSelectedVideoIds([option.variantId])
                                      return
                                    }
                                    setSourcePickerSelectedId(option.sourceId)
                                    setSourcePickerSelectedVideoIds(prev => (prev.includes(option.variantId) ? prev.filter(id => id !== option.variantId) : [...prev, option.variantId]))
                                  }}
                                  type="checkbox"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-semibold text-(--ui-text-primary)">{option.label}</span>
                                  <span className="block truncate text-(--ui-text-secondary)">{option.variantId}</span>
                                </span>
                              </label>
                            )
                          })
                        )}
                      </div>
                      <div className="mt-3 flex gap-2">
                      <Button disabled={!sourcePickerSelectedId && sourcePickerSelectedVideoIds.length === 0 && !mixcutSource} onClick={() => {
                        setSourcePickerSelectedId('')
                        setSourcePickerSelectedVideoIds([])
                        setMixcutSource(null)
                      }} size="sm" type="button" variant="outline">
                        取消选择
                      </Button>
                      <Button disabled={!sourcePickerSelectedId || sourcePickerSelectedVideoIds.length === 0} onClick={confirmSourcePicker} size="sm" type="button">
                        确认引用
                      </Button>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="目标时长（秒）">
                        <TextInput disabled={isBusy} max={120} min={6} onChange={event => setTargetDurationSec(Math.min(120, Math.max(6, Number(event.target.value) || 20)))} type="number" value={targetDurationSec} />
                      </Field>
                      <Field label="实拍占比（%）">
                        <TextInput disabled={isBusy} max={90} min={10} onChange={event => setMinRealRatio(Math.min(0.9, Math.max(0.1, (Number(event.target.value) || 30) / 100)))} type="number" value={Math.round(minRealRatio * 100)} />
                      </Field>
                    </div>
                  </div>
                ) : activeMode === 'original' ? (
                  <>
                    <Field label="原创脚本 / 创意描述">
                      <TextArea
                        disabled={isBusy}
                        maxLength={2000}
                        onChange={event => setOriginalScript(event.target.value.slice(0, 2000))}
                        placeholder="描述画面、场景、主体、动作、风格、卖点；也可以粘贴完整分镜脚本。"
                        value={originalScript}
                      />
                    </Field>
                    <label className="flex items-center gap-2 text-xs text-(--ui-text-secondary)">
                      <input checked={originalEnhancePrompt} disabled={isBusy} onChange={event => setOriginalEnhancePrompt(event.target.checked)} type="checkbox" />
                      使用 DeepSeen 提示词增强
                    </label>
                  </>
                ) : (
                  <>
                    <Field label={activeMode === 'smart' && kind === 'image' ? '产品名称 / 关键词' : '产品标题 / 关键词'}>
                      <TextInput disabled={isBusy} onChange={event => setProductTitle(event.target.value)} placeholder="例如：美国卷发棒、男士素色 T 恤" value={productTitle} />
                    </Field>
                    <Field label={activeMode === 'smart' ? '卖点（可选，1-3 条）' : '核心卖点'}>
                      {activeMode === 'smart' && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {SELLING_POINT_HINT_TAGS.map(tag => {
                            const prefix = `${tag}: `
                            const disabled = isBusy || sellingPoints.includes(prefix) || sellingPoints.length >= 1000
                            return (
                              <button
                                className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-2 py-0.5 text-xs text-(--ui-text-secondary) hover:text-(--ui-text-primary) disabled:opacity-40"
                                disabled={disabled}
                                key={tag}
                                onClick={() => setSellingPoints(prev => (prev ? `${prev}\n${prefix}` : prefix).slice(0, 1000))}
                                type="button"
                              >
                                + {tag}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      <TextArea disabled={isBusy} maxLength={1000} onChange={event => setSellingPoints(event.target.value.slice(0, 1000))} placeholder="卖点1: ...&#10;卖点2: ...&#10;卖点3: ..." value={sellingPoints} />
                    </Field>
                    {activeMode === 'smart' && (
                      <div className="grid gap-3 md:grid-cols-2">
                        <Field label="知识库参考">
                          <Select
                            disabled={isBusy || selectedViralDnaId !== ''}
                            onChange={event => {
                              const value = event.target.value
                              setKnowledgeReferenceIds(value ? [value] : [])
                              if (value) setSelectedViralDnaId('')
                            }}
                            value={knowledgeReferenceIds[0] || ''}
                          >
                            <option value="">不使用</option>
                            {(kind === 'video' ? videoKnowledgeItems : knowledgeItems).map(item => (
                              <option key={item.id} value={item.id}>{compactItemLabel(item)}</option>
                            ))}
                          </Select>
                        </Field>
                        {kind === 'video' && (
                          <Field label="爆款 DNA 参考">
                            <div className="grid grid-cols-[1fr_auto] gap-2">
                              <Select
                                disabled={isBusy || knowledgeReferenceIds.length > 0}
                                onChange={event => {
                                  setSelectedViralDnaId(event.target.value)
                                  if (event.target.value) setKnowledgeReferenceIds([])
                                  const selected = viralDnaOptions.find(item => item.id === event.target.value)
                                  const suggested = Number(selected?.targetDurationSec || 0)
                                  if (suggested > 0) setTargetDurationSec(suggested)
                                }}
                                value={selectedViralDnaId}
                              >
                                <option value="">不使用</option>
                                {viralDnaOptions.map(item => (
                                  <option key={item.id} value={item.id}>{compactItemLabel(item)}</option>
                                ))}
                              </Select>
                              <Button disabled={isBusy || viralDnaLoading || !productTitle.trim()} onClick={() => void loadViralDnaOptions()} size="sm" type="button" variant="outline">
                                {viralDnaLoading ? '加载中' : '加载'}
                              </Button>
                            </div>
                          </Field>
                        )}
                      </div>
                    )}
                  </>
                )}

                <div className="grid gap-3 md:grid-cols-4">
                  <Field label="地区">
                    <Select disabled={isBusy} onChange={event => setRegion(event.target.value)} value={region}>
                      <option value="美国">美国</option>
                      <option value="英国">英国</option>
                      <option value="欧洲">欧洲</option>
                      <option value="日本">日本</option>
                    </Select>
                  </Field>
                  {!(kind === 'video' && activeMode === 'mixcut') && (
                    <Field label="比例">
                      <Select disabled={isBusy} onChange={event => setAspectRatio(event.target.value)} value={aspectRatio}>
                        {aspectOptions.map(value => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </Select>
                    </Field>
                  )}
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
                    {kind === 'image' && activeMode === 'original' ? (
                      <TextInput disabled={isBusy} max={10} min={1} onChange={event => setOriginalCount(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} type="number" value={originalCount} />
                    ) : kind === 'image' ? (
                      <TextInput disabled value={activeMode === 'smart' ? `${SMART_IMAGE_OUTPUT_COUNT} 张` : `${IMAGE_RECREATE_OUTPUT_COUNT} 张`} />
                    ) : activeMode === 'smart' ? (
                      <div className="grid grid-cols-2 gap-2">
                        <TextInput disabled={isBusy} max={120} min={6} onChange={event => setTargetDurationSec(Math.min(120, Math.max(6, Number(event.target.value) || 15)))} type="number" value={targetDurationSec} />
                        <TextInput disabled={isBusy} max={10} min={1} onChange={event => setCount(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} type="number" value={count} />
                      </div>
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
                      setEditedPrompts({})
                      setOriginalScript('')
                      setOriginalEnhancePrompt(false)
                      setOriginalCount(1)
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
                    <p className="mt-1 text-xs text-(--ui-text-secondary)">DeepSeen 已完成素材分析，可编辑提示词后开始正式生成。</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {modelRisk?.level === 'WARN' && (
                      <Button onClick={() => void stopRiskRecreation()} type="button" variant="outline">
                        停止并退回生成积分
                      </Button>
                    )}
                    <Button onClick={() => void cancelRecreation()} type="button" variant="outline">
                      返回修改
                    </Button>
                  <Button onClick={() => void confirmGenerate()} type="button">
                    确认并生成
                  </Button>
                  </div>
                </div>
                {modelRisk && modelRisk.level !== 'PASS' && (
                  <div className="mt-3 rounded border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-(--ui-text-primary)">
                    <div className="font-semibold">{modelRisk.title || '模型风险提示'}</div>
                    {modelRisk.message && <div className="mt-1">{modelRisk.message}</div>}
                  </div>
                )}
                {kind === 'video' && dynamicClipPlan && (
                  <Field label="视频生成方式">
                    <Select onChange={event => setDynamicClipMode(event.target.value as 'recommended' | 'compress' | '')} value={dynamicClipMode}>
                      <option value="">默认</option>
                      <option value="recommended">按 DeepSeen 建议时长生成</option>
                      <option value="compress">压缩成单段生成</option>
                    </Select>
                  </Field>
                )}
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {variants.map((variant, index) => (
                    <article className="rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-3" key={variant.id}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-primary">方案 {index + 1}</span>
                        {variant.strategy && <span className="truncate text-[11px] text-(--ui-text-secondary)">{variant.strategy}</span>}
                      </div>
                      {variant.referenceImage && <img alt="" className="mb-2 h-20 w-20 rounded object-cover" src={variant.referenceImage} />}
                      <TextArea
                        className="max-h-48 text-xs leading-5"
                        onChange={event => setEditedPrompts(prev => ({ ...prev, [variant.id]: event.target.value }))}
                        value={editedPrompts[variant.id] ?? variant.text}
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button onClick={() => void copyPrompt(editedPrompts[variant.id] ?? variant.text)} size="xs" type="button" variant="outline">
                          复制
                        </Button>
                        {editedPrompts[variant.id] !== undefined && editedPrompts[variant.id] !== variant.text && (
                          <Button onClick={() => setEditedPrompts(prev => {
                            const next = { ...prev }
                            delete next[variant.id]
                            return next
                          })} size="xs" type="button" variant="ghost">
                            恢复原文
                          </Button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {phase === 'done' && (
              <section className="rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-4">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-(--ui-text-primary)">生成结果</h2>
                  <div className="flex gap-2">
                  <Button onClick={resetFlow} size="xs" type="button" variant="outline">
                    继续创作
                  </Button>
                  <Button onClick={() => void refreshHistory()} size="xs" type="button" variant="ghost">
                    刷新历史
                  </Button>
                  </div>
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
                        {item.prompt && <p className="mt-2 line-clamp-3 text-xs text-(--ui-text-secondary)">{item.prompt}</p>}
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
