import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_TIMEOUT_MS = 3600000
const VIDEO_TIMEOUT_MS = 3600000
const EMPTY_TEXT_VALUES = new Set([
  '无',
  '没有',
  '暂无',
  '不填',
  '不限',
  '任意',
  '无所谓',
  'none',
  'n/a',
  'na',
  'null',
  'undefined',
  '-',
  '/'
])

async function loadSdk() {
  if (process.env.DEEPSEEN_SDK_PATH) {
    const sdkPath = resolve(process.env.DEEPSEEN_SDK_PATH)
    return import(pathToFileURL(sdkPath).href)
  }
  try {
    return await import('deepseen-sdk')
  } catch (err) {
    const require = createRequire(import.meta.url)
    const localDist = resolve(process.cwd(), 'node_modules', 'deepseen-sdk', 'dist', 'index.js')
    if (existsSync(localDist)) {
      return import(pathToFileURL(localDist).href)
    }
    throw err
  }
}

function readStdin() {
  return new Promise((resolveRead, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      data += chunk
    })
    process.stdin.on('end', () => resolveRead(data))
    process.stdin.on('error', reject)
  })
}

function clean(value) {
  if (Array.isArray(value)) {
    return value.map(clean).filter(item => item !== undefined)
  }
  if (value && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) {
      const next = clean(item)
      if (next !== undefined) out[key] = next
    }
    return out
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || EMPTY_TEXT_VALUES.has(trimmed.toLowerCase())) return undefined
    return trimmed
  }
  return value === null ? undefined : value
}

function optionalText(value) {
  const cleaned = clean(value)
  if (typeof cleaned !== 'string') return cleaned
  if (cleaned.includes('不限') || cleaned.includes('无要求')) return undefined
  return cleaned
}

function normalizeSampleTier(value) {
  const cleaned = optionalText(value)
  if (typeof cleaned !== 'string') return cleaned
  const normalized = cleaned.toLowerCase()
  if (['light', '轻量', '轻度', '简单'].includes(normalized)) return 'light'
  if (['standard', '标准', '中等', '普通'].includes(normalized)) return 'standard'
  if (['deep', '深度', '深入', '详细'].includes(normalized)) return 'deep'
  return cleaned
}

function outputUrls(job) {
  return Array.isArray(job?.outputs) ? job.outputs.map(item => item?.url).filter(Boolean) : []
}

const HIDDEN_FIELD_NAMES = new Set([
  'object',
  'type',
  'raw',
  'original',
  'standardSnapshot',
  'inputRows',
  'scoredRows',
  'productFileIds',
  'product_file_ids',
  'idempotencyKey',
  'idempotency_key',
  'webhookUrl',
  'webhook_url',
  'metadata',
  'cache_hit',
  'cached_from_analysis_id',
  'data_request_count',
  'data_quota_units',
  'data_charge_credits',
  'creatorKey',
  'variant_id',
  'index'
])

const OPTIONAL_RUNTIME_FIELDS = new Set([
  'id',
  'job_id',
  'jobId',
  'result_id',
  'resultId',
  'status',
  'status_text',
  'statusText',
  'progress',
  'current_step',
  'currentStep',
  'created_at',
  'createdAt',
  'completed_at',
  'completedAt',
  'updated_at',
  'updatedAt',
  'logs'
])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toUserVisibleValue(value, hiddenFields, path = '') {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value)) {
    const items = value
      .map((item, index) => toUserVisibleValue(item, hiddenFields, `${path}[${index}]`))
      .filter(item => item !== undefined)
    return items.length ? items : undefined
  }
  if (!isPlainObject(value)) return value

  const out = {}
  for (const [key, item] of Object.entries(value)) {
    const fieldPath = path ? `${path}.${key}` : key
    if (HIDDEN_FIELD_NAMES.has(key) || OPTIONAL_RUNTIME_FIELDS.has(key)) {
      hiddenFields.add(fieldPath)
      continue
    }
    const visible = toUserVisibleValue(item, hiddenFields, fieldPath)
    if (visible !== undefined) out[key] = visible
  }
  return Object.keys(out).length ? out : undefined
}

function stringifyScalar(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function appendMarkdown(lines, key, value, indent = 0) {
  const pad = '  '.repeat(indent)
  if (value === undefined || value === null || value === '') return
  if (Array.isArray(value)) {
    if (key) lines.push(`${pad}- ${key}:`)
    value.forEach((item, index) => {
      if (isPlainObject(item) || Array.isArray(item)) {
        lines.push(`${pad}  ${index + 1}.`)
        appendMarkdown(lines, '', item, indent + 2)
      } else {
        lines.push(`${pad}  ${index + 1}. ${stringifyScalar(item)}`)
      }
    })
    return
  }
  if (isPlainObject(value)) {
    if (key) lines.push(`${pad}- ${key}:`)
    for (const [childKey, childValue] of Object.entries(value)) {
      appendMarkdown(lines, childKey, childValue, key ? indent + 1 : indent)
    }
    return
  }
  if (key) lines.push(`${pad}- ${key}: ${stringifyScalar(value)}`)
  else lines.push(`${pad}${stringifyScalar(value)}`)
}

function userVisibleMarkdown(fields) {
  const lines = []
  appendMarkdown(lines, '', fields, 0)
  return lines.join('\n').trim()
}

function summarize(job) {
  const hiddenFields = new Set()
  const urls = outputUrls(job)
  const resultValue = job?.result !== undefined ? job.result : job
  const visibleResult = toUserVisibleValue(resultValue, hiddenFields)
  const visibleFields = clean({
    output_urls: urls,
    result: visibleResult
  })
  const summary = userVisibleMarkdown(visibleFields)
  return clean({
    ok: !job?.error && job?.status !== 'failed' && job?.status !== 'cancelled',
    job_id: job?.id,
    status: job?.status,
    output_urls: urls,
    result_id: job?.result_id,
    display_markdown: summary,
    user_visible_summary: summary,
    user_visible_fields: visibleFields,
    hidden_fields: [...hiddenFields],
    error: job?.error,
  })
}

function emitProgress(action, job, phase = 'running') {
  const payload = clean({
    __deepseen_progress: true,
    action,
    phase,
    job_id: job?.id,
    status: job?.status,
    progress: job?.progress,
    stage: job?.stage,
    message: job?.message || job?.status_text || job?.statusText,
    output_urls: outputUrls(job),
    result_id: job?.result_id,
    error: job?.error,
    updated_at: job?.updated_at || job?.updatedAt
  })
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

async function uploadMany(client, paths = [], purpose = 'product_image') {
  const urls = []
  const ids = []
  const files = []
  for (const path of paths || []) {
    if (!path) continue
    const file = await client.files.upload(path, purpose)
    files.push(file)
    if (file?.url) urls.push(file.url)
    if (file?.id) ids.push(file.id)
  }
  return { urls, ids, files }
}

async function waitMedia(job, args, defaultTimeoutMs) {
  const action = args.__action || 'media'
  const pollIntervalMs = Number(args.poll_interval_ms || 8000)
  const timeoutMs = Number(args.timeout_ms || defaultTimeoutMs)
  const startedAt = Date.now()
  let transientErrors = 0
  async function waitWithTransientRetry(handle, phase) {
    while (true) {
      try {
        return await handle.wait({
          pollIntervalMs,
          timeoutMs: Math.max(1, timeoutMs - (Date.now() - startedAt)),
          onProgress: current => emitProgress(action, current, phase)
        })
      } catch (err) {
        const code = err?.code || err?.cause?.code
        const message = err?.message || String(err)
        const isTransientNetwork = code === 'network_error' || /fetch failed|Connect Timeout|network/i.test(message)
        if (!isTransientNetwork || Date.now() - startedAt > timeoutMs || transientErrors >= 8) {
          throw err
        }
        transientErrors += 1
        emitProgress(action, {
          id: handle?.id,
          status: handle?.status || 'running',
          progress: handle?.data?.progress,
          message: `网络连接短暂异常，正在继续轮询（第 ${transientErrors} 次）`
        }, 'network_retry')
        await new Promise(resolve => setTimeout(resolve, Math.min(30000, pollIntervalMs)))
      }
    }
  }
  emitProgress(action, job, 'created')
  let result = await waitWithTransientRetry(job, 'running')
  if (result?.status === 'awaiting_confirmation' && args.auto_confirm !== false && typeof job.confirm === 'function') {
    emitProgress(action, result, 'awaiting_confirmation')
    const confirmed = await job.confirm({
      model: args.confirm_model || args.model,
      variants: result?.analysis?.variants
    })
    emitProgress(action, confirmed, 'confirmed')
    result = await waitWithTransientRetry(confirmed, 'running')
  }
  emitProgress(action, result, 'completed')
  return result
}

async function main() {
  const action = process.argv[2]
  const raw = (await readStdin()).replace(/^\uFEFF/, '')
  const args = raw.trim() ? JSON.parse(raw) : {}
  args.__action = action
  const { DeepseenClient } = await loadSdk()
  const apiKey = process.env.DEEPSEEN_API_KEY
  if (!apiKey) {
    throw Object.assign(new Error('DEEPSEEN_API_KEY is not configured'), {
      code: 'missing_api_key'
    })
  }
  const client = new DeepseenClient({
    apiKey,
    baseURL: process.env.DEEPSEEN_BASE_URL || undefined
  })

  if (action === 'ping') {
    console.log(JSON.stringify({ ok: true, result: await client.ping() }))
    return
  }

  if (action === 'upload_file') {
    const file = await client.files.upload(args.local_path, args.purpose || 'product_image')
    console.log(JSON.stringify({
      ok: true,
      file,
      id: file?.id,
      url: file?.url,
      purpose: file?.purpose,
      content_type: file?.content_type
    }))
    return
  }

  if (action === 'smart_image') {
    const uploaded = await uploadMany(client, args.local_paths, 'product_image')
    const job = await client.smartImage.recreations.create(clean({
      region: args.region,
      keywords: args.keywords,
      productImages: [...(args.product_images || []), ...(args.asset_urls || []), ...uploaded.urls],
      productFileIds: [...(args.product_file_ids || []), ...uploaded.ids],
      productDetails: args.product_details,
      includePrompts: args.include_prompts,
      metadata: args.metadata,
      webhookUrl: args.webhook_url,
      idempotencyKey: args.idempotency_key
    }))
    console.log(JSON.stringify({ ...summarize(await waitMedia(job, args, DEFAULT_TIMEOUT_MS)), uploaded_files: uploaded.files }))
    return
  }

  if (action === 'smart_video') {
    const uploaded = await uploadMany(client, args.local_paths, 'product_image')
    const job = await client.smartVideo.recreations.create(clean({
      region: args.region,
      productTitle: args.product_title,
      productImages: [...(args.product_images || []), ...(args.asset_urls || []), ...uploaded.urls],
      productFileIds: [...(args.product_file_ids || []), ...uploaded.ids],
      count: args.count,
      model: args.model,
      includePrompts: args.include_prompts,
      metadata: args.metadata,
      webhookUrl: args.webhook_url,
      idempotencyKey: args.idempotency_key
    }))
    console.log(JSON.stringify({ ...summarize(await waitMedia(job, args, VIDEO_TIMEOUT_MS)), uploaded_files: uploaded.files }))
    return
  }

  if (action === 'image_recreation') {
    const uploaded = await uploadMany(client, args.local_paths, 'product_image')
    const job = await client.image.recreations.create(clean({
      competitorProductUrl: args.competitor_product_url,
      productImages: [...(args.product_images || []), ...(args.asset_urls || []), ...uploaded.urls],
      productFileIds: [...(args.product_file_ids || []), ...uploaded.ids],
      model: args.model,
      aspectRatio: args.aspect_ratio,
      autoGenerate: args.auto_generate,
      includePrompts: args.include_prompts,
      metadata: args.metadata,
      webhookUrl: args.webhook_url,
      idempotencyKey: args.idempotency_key
    }))
    console.log(JSON.stringify({ ...summarize(await waitMedia(job, args, DEFAULT_TIMEOUT_MS)), uploaded_files: uploaded.files }))
    return
  }

  if (action === 'video_recreation') {
    const product = await uploadMany(client, args.product_local_paths || args.local_paths, 'product_image')
    let competitorVideoUrl = args.competitor_video_url
    let referenceUpload = null
    if (!competitorVideoUrl && args.reference_video_local_path) {
      referenceUpload = await client.files.upload(args.reference_video_local_path, 'reference_video')
      competitorVideoUrl = referenceUpload.url
    }
    const job = await client.video.recreations.create(clean({
      competitorVideoUrl,
      productImages: [...(args.product_images || []), ...(args.asset_urls || []), ...product.urls],
      productFileIds: [...(args.product_file_ids || []), ...product.ids],
      model: args.model,
      groupCount: args.group_count,
      autoGenerate: args.auto_generate,
      includePrompts: args.include_prompts,
      metadata: args.metadata,
      webhookUrl: args.webhook_url,
      idempotencyKey: args.idempotency_key
    }))
    console.log(JSON.stringify({
      ...summarize(await waitMedia(job, args, VIDEO_TIMEOUT_MS)),
      uploaded_files: product.files,
      reference_video_file: referenceUpload
    }))
    return
  }

  if (action === 'product_report') {
    const uploaded = await uploadMany(client, args.local_paths, 'product_image')
    const job = await client.productReports.create(clean({
      productName: args.product_name,
      targetMarket: args.target_market,
      targetAudience: args.target_audience,
      platform: args.platform,
      sellingPoints: args.selling_points,
      purchaseCost: args.purchase_cost,
      expectedPrice: args.expected_price,
      weightKg: args.weight_kg,
      dimensionsCm: args.dimensions_cm,
      plannedStockUnits: args.planned_stock_units,
      restockCycle: args.restock_cycle,
      supplierCount: args.supplier_count,
      enablePatentSearch: args.enable_patent_search,
      productImageUrls: [...(args.product_image_urls || []), ...(args.product_images || []), ...(args.asset_urls || []), ...uploaded.urls]
    }))
    console.log(JSON.stringify({ ...summarize(await job.wait({ pollIntervalMs: Number(args.poll_interval_ms || 8000), timeoutMs: Number(args.timeout_ms || DEFAULT_TIMEOUT_MS) })), uploaded_files: uploaded.files }))
    return
  }

  if (action === 'competitor_single') {
    const job = await client.competitors.analyze(clean({
      productUrl: args.product_url,
      region: args.region
    }))
    console.log(JSON.stringify(summarize(await job.wait({ pollIntervalMs: Number(args.poll_interval_ms || 8000), timeoutMs: Number(args.timeout_ms || DEFAULT_TIMEOUT_MS) }))))
    return
  }

  if (action === 'competitor_multi') {
    const job = await client.competitors.analyzeMulti(clean({
      productKeyword: args.product_keyword,
      region: args.region
    }))
    console.log(JSON.stringify(summarize(await job.wait({ pollIntervalMs: Number(args.poll_interval_ms || 8000), timeoutMs: Number(args.timeout_ms || DEFAULT_TIMEOUT_MS) }))))
    return
  }

  if (action === 'creator_analysis') {
    const job = await client.creators.analyze(clean({
      productName: optionalText(args.product_name),
      targetMarket: optionalText(args.target_market),
      targetProductPrice: optionalText(args.target_product_price),
      categoryLevel1: optionalText(args.category_level1),
      categoryLevel2: optionalText(args.category_level2),
      competitorName: optionalText(args.competitor_name),
      targetUserAge: optionalText(args.target_user_age),
      targetUserGender: optionalText(args.target_user_gender),
      sampleTier: normalizeSampleTier(args.sample_tier)
    }))
    console.log(JSON.stringify(summarize(await job.wait({ pollIntervalMs: Number(args.poll_interval_ms || 8000), timeoutMs: Number(args.timeout_ms || DEFAULT_TIMEOUT_MS) }))))
    return
  }

  if (action === 'creator_score') {
    let uploadedFileUrl = args.uploaded_file_url
    let uploaded = null
    if (!uploadedFileUrl && args.local_file_path) {
      uploaded = await client.files.upload(args.local_file_path, 'creator_score_file')
      uploadedFileUrl = uploaded.url
    }
    const job = await client.creatorScores.create(clean({
      productName: args.product_name,
      targetMarket: args.target_market,
      targetProductPrice: args.target_product_price,
      categoryLevel1: args.category_level1,
      categoryLevel2: args.category_level2,
      uploadedFileUrl,
      standardSelectionMode: args.standard_selection_mode || 'AUTO',
      standardId: args.standard_id,
      rows: args.rows
    }))
    console.log(JSON.stringify({ ...summarize(await job.wait({ pollIntervalMs: Number(args.poll_interval_ms || 8000), timeoutMs: Number(args.timeout_ms || DEFAULT_TIMEOUT_MS) })), uploaded_file: uploaded }))
    return
  }

  if (action === 'video_analysis') {
    let videoUrl = args.video_url
    let uploaded = null
    if (args.source === 'UPLOAD' && !videoUrl && args.local_video_path) {
      uploaded = await client.files.upload(args.local_video_path, 'video_analysis')
      videoUrl = uploaded.url
    }
    const job = await client.videos.analyses.create(clean({
      source: args.source,
      sourceUrl: args.source_url,
      videoUrl,
      targetMarket: args.target_market,
      title: args.title
    }))
    console.log(JSON.stringify({ ...summarize(await job.wait({ pollIntervalMs: Number(args.poll_interval_ms || 8000), timeoutMs: Number(args.timeout_ms || DEFAULT_TIMEOUT_MS) })), uploaded_file: uploaded }))
    return
  }

  throw new Error(`Unknown DeepSeen action: ${action}`)
}

main().catch(err => {
  const body = {
    ok: false,
    error: {
      name: err?.name,
      code: err?.code,
      status: err?.status,
      message: err?.message || String(err)
    }
  }
  console.log(JSON.stringify(body))
  process.exitCode = 1
})
