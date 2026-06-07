const MEDIA_TOOL_NAMES = new Set([
  'image_generate',
  'video_generate',
  'deepseen_smart_video_recreations_create_and_wait',
  'deepseen_smart_image_recreations_create_and_wait',
  'deepseen_image_recreations_create_and_wait',
  'deepseen_video_recreations_create_and_wait',
])

type MediaKind = 'image' | 'video'

interface MediaItem {
  kind: MediaKind
  url: string
  label: string
}

export function isMediaGenerationTool(toolName: string): boolean {
  return MEDIA_TOOL_NAMES.has(toolName)
}

export function mediaGenerationStartedPreview(toolName: string): string | undefined {
  if (toolName === 'image_generate') {
    return '正在调用外部图片生成工具，通常需要几秒到几十秒，请稍等...'
  }
  if (toolName === 'video_generate') {
    return '正在调用外部视频生成工具，可能需要几十秒到几分钟，请稍等...'
  }
  if (toolName === 'deepseen_smart_video_recreations_create_and_wait') {
    return '正在调用 Deepseen 视频智创：上传素材、创建任务并等待 SDK 轮询完成，通常需要几十秒到几分钟。'
  }
  if (toolName === 'deepseen_video_recreations_create_and_wait') {
    return '正在调用 Deepseen 视频二创：上传参考视频/产品图、创建任务并等待 SDK 轮询完成，通常需要几十秒到几分钟。'
  }
  if (toolName === 'deepseen_smart_image_recreations_create_and_wait') {
    return '正在调用 Deepseen 图片智创：上传素材、创建任务并等待 SDK 轮询完成，通常需要几秒到几十秒。'
  }
  if (toolName === 'deepseen_image_recreations_create_and_wait') {
    return '正在调用 Deepseen 图片二创：上传产品图、创建任务并等待 SDK 轮询完成，通常需要几秒到几十秒。'
  }
  return undefined
}

export function generatedMediaMarkdown(toolName: string, rawOutput: unknown): string {
  if (!isMediaGenerationTool(toolName)) return ''

  const parsed = parseToolOutput(rawOutput)
  if (!parsed || parsed.success === false) return ''

  const items = extractMediaItems(toolName, parsed)
  if (items.length === 0) return ''

  const heading = isVideoTool(toolName)
    ? '媒体生成工具已完成，结果如下：'
    : '图片生成工具已完成，结果如下：'
  const parts = [`\n\n${heading}\n`]
  const seen = new Set<string>()

  for (const item of items) {
    if (seen.has(item.url)) continue
    seen.add(item.url)
    if (item.kind === 'image') {
      parts.push(`![${escapeMarkdownLabel(item.label)}](${markdownDestination(item.url)})`)
      parts.push(`[下载图片](${markdownDestination(item.url)})`)
    } else {
      parts.push(`[${escapeMarkdownLabel(item.label)}](${markdownDestination(item.url)})`)
      parts.push(`[下载视频](${markdownDestination(item.url)})`)
    }
    parts.push('')
  }

  return parts.join('\n')
}

function parseToolOutput(rawOutput: unknown): Record<string, unknown> | null {
  if (rawOutput && typeof rawOutput === 'object' && !Array.isArray(rawOutput)) {
    return rawOutput as Record<string, unknown>
  }
  if (typeof rawOutput !== 'string') return null
  const text = rawOutput.trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function extractMediaItems(toolName: string, parsed: Record<string, unknown>): MediaItem[] {
  const expectedKind: MediaKind = isVideoTool(toolName) ? 'video' : 'image'
  const out: MediaItem[] = []

  const direct = stringValue(parsed[expectedKind])
  if (direct) {
    out.push({ kind: expectedKind, url: direct, label: defaultMediaLabel(expectedKind, direct) })
  }

  const plural = parsed[expectedKind === 'video' ? 'videos' : 'images']
  if (Array.isArray(plural)) {
    plural.forEach((entry, index) => {
      const url = mediaUrlFromUnknown(entry)
      if (url) {
        out.push({
          kind: expectedKind,
          url,
          label: defaultMediaLabel(expectedKind, url, index + 1),
        })
      }
    })
  }

  for (const key of ['url', 'output_url', 'file', 'file_path', 'path', 'local_path']) {
    const url = stringValue(parsed[key])
    if (url) out.push({ kind: expectedKind, url, label: defaultMediaLabel(expectedKind, url) })
  }

  return out
}

function isVideoTool(toolName: string): boolean {
  return toolName === 'video_generate'
    || toolName === 'deepseen_smart_video_recreations_create_and_wait'
    || toolName === 'deepseen_video_recreations_create_and_wait'
}

function defaultMediaLabel(kind: MediaKind, url: string, index?: number): string {
  const fromUrl = url.split(/[\\/]/).pop()?.split(/[?#]/, 1)[0] || ''
  if (fromUrl && /\.[a-z0-9]{2,5}$/i.test(fromUrl)) return fromUrl
  const suffix = index ? ` ${index}` : ''
  return kind === 'video' ? `generated-video${suffix}.mp4` : `generated-image${suffix}.png`
}

function mediaUrlFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const record = value as Record<string, unknown>
  return stringValue(record.url)
    || stringValue(record.path)
    || stringValue(record.file_path)
    || stringValue(record.local_path)
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function markdownDestination(value: string): string {
  const escaped = value.replace(/\\/g, '/').replace(/>/g, '%3E')
  return /[\s()]/.test(escaped) ? `<${escaped}>` : escaped
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[[\]\\]/g, '\\$&')
}
