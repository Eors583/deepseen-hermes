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
    const items = value.map(clean).filter(item => item !== undefined)
    return items.length ? items : undefined
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
  'analysis_mode',
  'source_notes',
  'sourceNotes',
  'promptData',
  'reference_images',
  'referenceImages',
  'key',
  '__dataSource',
  '__apifyEnriched',
  'cache_hit',
  'cached_from_analysis_id',
  'data_request_count',
  'data_quota_units',
  'data_charge_credits',
  'creatorKey',
  'userId',
  'user_id',
  'product_id',
  'productId',
  'shop_id',
  'shopId',
  'creator_id',
  'creatorId',
  'creatorKey',
  'file_id',
  'fileId',
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

const FIELD_LABELS = {
  output_urls: '生成结果链接',
  outputs: '生成结果',
  url: '链接',
  urls: '链接',
  file: '文件',
  files: '文件',
  filename: '文件名',
  result: '',
  analysisResult: '分析结果',
  analysis_result: '分析结果',
  report: '报告',
  conclusion: '结论',
  final_verdict: '最终判断',
  marketVerdict: '市场判断',
  outlook: '市场展望',
  recommendation: '建议',
  recommendations: '建议',
  action_items: '行动建议',
  summary: '摘要',
  title: '标题',
  name: '名称',
  productName: '产品名称',
  product_name: '产品名称',
  productUrl: '商品链接',
  product_url: '商品链接',
  competitorProductUrl: '竞品链接',
  competitor_product_url: '竞品链接',
  source_url: '来源链接',
  sourceUrl: '来源链接',
  fastmoss_url: '商品来源链接',
  creator_url: '达人主页',
  creatorUrl: '达人主页',
  video_url: '视频链接',
  videoUrl: '视频链接',
  image_url: '图片链接',
  imageUrl: '图片链接',
  region: '地区',
  targetMarket: '目标市场',
  target_market: '目标市场',
  platform: '平台',
  category: '类目',
  categoryLevel1: '一级类目',
  category_level1: '一级类目',
  categoryLevel2: '二级类目',
  category_level2: '二级类目',
  keywords: '关键词',
  productKeyword: '产品关键词',
  product_keyword: '产品关键词',
  product_details: '产品信息',
  productDetails: '产品信息',
  selling_points: '卖点',
  sellingPoints: '卖点',
  price: '价格',
  targetProductPrice: '目标价格',
  target_product_price: '目标价格',
  purchaseCost: '采购成本',
  purchase_cost: '采购成本',
  expectedPrice: '预期售价',
  expected_price: '预期售价',
  rating: '评分',
  review_count: '评论数',
  reviewCount: '评论数',
  sold_count: '销量',
  soldCount: '销量',
  video_count: '视频数',
  videoCount: '视频数',
  shop_name: '店铺名称',
  shopName: '店铺名称',
  brand: '品牌',
  top_products: '热门商品',
  topProducts: '热门商品',
  products: '商品',
  competitors: '竞品',
  source_notes: '数据来源说明',
  sourceNotes: '数据来源说明',
  evidence: '依据',
  evidence_level: '依据完整度',
  evidenceLevel: '依据完整度',
  evidence_confidence: '依据可信度',
  evidenceConfidence: '依据可信度',
  dataReliability: '数据可靠性',
  reliability: '可靠性',
  score: '分数',
  scoreTotal: '总分',
  score_total: '总分',
  scoreTier: '等级',
  score_tier: '等级',
  tierLabel: '等级说明',
  tier_label: '等级说明',
  dimensions: '评分维度',
  items: '明细',
  comment: '说明',
  comments: '说明',
  analysis: '分析',
  intelligence_analysis: '综合分析',
  pitfall_guide: '避坑提示',
  opportunity_window: '机会窗口',
  pain: '痛点',
  opportunity: '机会',
  risk: '风险',
  risks: '风险',
  audience: '人群',
  targetAudience: '目标人群',
  target_audience: '目标人群',
  ideal_creator_profile: '理想达人画像',
  creator_name: '达人名称',
  creatorName: '达人名称',
  handle: '账号',
  followers: '粉丝数',
  likes: '点赞数',
  engagement_rate: '互动率',
  engagementRate: '互动率',
  script: '脚本',
  hooks: '开场钩子',
  scenes: '场景',
  scene: '场景',
  copywriting: '文案',
  revised_prompt: '生成提示',
  revisedPrompt: '生成提示',
  strategy: '方案说明',
  kind: '类型',
  model: '模型',
  aspectRatio: '画面比例',
  aspect_ratio: '画面比例',
  count: '数量',
  productImage: '商品图',
  product_image: '商品图',
  sales_analysis: '销量表现',
  core_selling_points: '核心卖点',
  consumer_persona: '用户画像',
  user_pain_points: '用户痛点',
  viral_video_url: '爆款视频链接',
  video_style: '视觉风格',
  script_structure: '脚本结构',
  viral_script: '爆款脚本',
  breakthrough_guide: '突破指南',
  intelligence_findings: '情报发现',
  opportunity_windows: '机会窗口',
  cross_product_summary: '多竞品总结',
  battlefield_summary: '竞争战场总结',
  priority_angle: '优先切入角度',
  execution_order: '执行顺序',
  risk_boundary: '风险边界',
  six_p_common_analysis: '6P 共性分析',
  competitor_6p_table: '竞品 6P 横向对比',
  single_competitor_6p: '单竞品 6P 分析',
  product: '产品基因',
  profile: '用户画像',
  path: '流量路径',
  pitch: '内容打法',
  category_level1: '一级类目',
  category_level2: '二级类目',
  competitor_name: '竞品名称',
  sample_creators: '样本达人',
  sample_target: '目标样本量',
  five_force_commonality: '五力共性',
  scoring_standard: '评分标准',
  persona_risk_supplement: '达人画像与风险补充',
  live_observation: '直播与画像观察',
  data_availability_notes: '数据可用性说明',
  personaFit: '人设匹配',
  creatorPositioning: '达人定位',
  contentStyle: '内容风格',
  marketLanguage: '市场语言',
  brandSafety: '品牌安全',
  activitySignal: '活跃迹象',
  productFit: '商品适配',
  confidence: '可信度',
  validation: '验证结果',
  highPerformerDefinition: '高绩效定义',
  highPerformerAvgScore: '高绩效平均分',
  otherPerformerAvgScore: '其他达人平均分',
  separation: '区分度',
  notes: '说明',
  dimensionWeights: '维度权重',
  sampleSize: '样本数',
  metrics: '指标阈值',
  indicators: '指标',
  weight: '权重',
  sampleCount: '样本覆盖数',
  inactiveReason: '未入权重原因',
  insight: '指标洞察',
  audienceFit: '产品适配',
  contentPower: '内容触发',
  growthMomentum: '带货活跃',
  commerceEfficiency: '合作风险',
  transactionProof: '成交验证',
  creatorName: '达人名称',
  prefilterStatus: '预筛状态',
  totalScore: '总分',
  scoreFormula: '总分公式',
  tier: '档位',
  starRating: '星级',
  commissionRate: '佣金率',
  commission_rate: '佣金率',
  categoryName: '类目名称',
  category_name: '类目名称',
  day28_units_sold: '28 天销量',
  day28UnitsSold: '28 天销量',
  creator_count: '达人数',
  creatorCount: '达人数',
  day28LiveCountSample: '28 天直播场次样本',
  day28LiveGmvSample: '28 天直播 GMV 样本',
  liveGpmSample: '直播 GPM 样本',
  audiencePersonaSample: '人群画像样本',
  avgDay28LiveCount: '平均 28 天直播场次',
  avgDay28LiveGmv: '平均 28 天直播 GMV',
  avgLiveGpm: '平均直播 GPM',
  avgAudiencePersonaMatch: '平均人群画像匹配分',
  dimensionScores: '维度得分',
  diagnosis: '诊断',
  disqualifyReasons: '不合作原因',
  missingFields: '缺失字段',
  homepageUrl: '达人主页',
  monthlyGmv: '月 GMV',
  gpm: 'GPM',
  videoCr: '视频转化率',
  meta: '视频信息',
  source: '来源类型',
  sourceUrl: '原视频链接',
  thumbnailUrl: '缩略图',
  duration: '时长',
  highlights: '可复制亮点',
  improvements: '可优化短板',
  visualStyle: '视觉风格',
  scriptStructure: '脚本结构',
  viralScript: '爆款脚本',
  selectionScore: '选品评分',
  listingAdvice: 'Listing 建议',
  patentRisk: '专利风险',
  riskLevel: '风险等级',
  advice: '处理建议',
  aiVideoFeasibility: 'AI 视频可行性',
  opportunityScore: '机会分',
  marketPhase: '市场阶段',
  keyDriver: '增长驱动力',
  veto: '否决原因',
}

const EMBEDDED_FIELD_LABELS = Object.fromEntries(
  Object.entries(FIELD_LABELS).filter(([, label]) => label)
)

const THIRD_PARTY_SOURCE_NAMES = [
  /\bFastMoss\b/gi,
  /\bPerplexity\b/gi,
  /\bExa\b/gi,
  /\bOpenAI\b/gi,
  /\bClaude\b/gi,
  /\bGemini\b/gi,
]

function sanitizeDisplayString(value) {
  let text = String(value)
  for (const pattern of THIRD_PARTY_SOURCE_NAMES) {
    text = text.replace(pattern, '数据来源')
  }
  text = replaceEmbeddedFieldNames(text)
  text = replaceEmbeddedScalarValues(text)
  return text.replace(/数据来源\s*数据来源/g, '数据来源').trim()
}

const VALUE_LABELS = {
  high: '高',
  medium: '中',
  low: '低',
  partial: '部分证据',
  insufficient: '数据有待考究',
  sufficient: '证据充分',
  queued: '排队中',
  processing: '处理中',
  analyzing: '分析中',
  generating: '生成中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  LINK: '外链',
  UPLOAD: '上传视频',
}

function translateScalarValue(value) {
  if (typeof value !== 'string') return value
  return VALUE_LABELS[value] || VALUE_LABELS[value.toLowerCase()] || value
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceEmbeddedFieldNames(text) {
  let next = text
  const entries = Object.entries(EMBEDDED_FIELD_LABELS).sort((a, b) => b[0].length - a[0].length)
  for (const [field, label] of entries) {
    const pattern = new RegExp(`(^|[\\s,，;；。\\n\\r\\t\\-•*\\[\\]()（）])${escapeRegex(field)}\\s*:`, 'g')
    next = next.replace(pattern, `$1${label}:`)
  }
  return next
}

function replaceEmbeddedScalarValues(text) {
  let next = text
  const entries = Object.entries(VALUE_LABELS).sort((a, b) => b[0].length - a[0].length)
  for (const [raw, label] of entries) {
    const pattern = new RegExp(`(:\\s*)${escapeRegex(raw)}(?=$|[\\s,，;；。\\n\\r\\t\\)）\\]\\}])`, 'gi')
    next = next.replace(pattern, `$1${label}`)
  }
  return next
}

function labelForKey(key) {
  if (!key) return ''
  return FIELD_LABELS[key] !== undefined ? FIELD_LABELS[key] : '补充信息'
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
  if (typeof value === 'string') return sanitizeDisplayString(translateScalarValue(value))
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function appendMarkdown(lines, key, value, indent = 0) {
  const pad = '  '.repeat(indent)
  const label = labelForKey(key)
  if (value === undefined || value === null || value === '') return
  if (Array.isArray(value)) {
    if (label) lines.push(`${pad}- ${label}:`)
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
    if (label) lines.push(`${pad}- ${label}:`)
    for (const [childKey, childValue] of Object.entries(value)) {
      appendMarkdown(lines, childKey, childValue, label ? indent + 1 : indent)
    }
    return
  }
  if (label) lines.push(`${pad}- ${label}: ${stringifyScalar(value)}`)
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
