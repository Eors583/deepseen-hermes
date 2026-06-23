import {
  Brain,
  type IconComponent,
  Lock,
  MessageCircle,
  Mic,
  Monitor,
  Moon,
  Palette,
  Sparkles,
  Sun,
  Wrench
} from '@/lib/icons'
import type { ThemeMode } from '@/themes/context'

import { defineFieldCopy } from './field-copy'
import type { DesktopConfigSection } from './types'

// Provider group definitions used to fold raw env-var names like
// ``XAI_API_KEY`` into a single "xAI" card with a friendly label, short
// description, and signup URL. Membership is determined by longest
// prefix match (see ``providerGroup`` in helpers.ts) so more specific
// prefixes (``MINIMAX_CN_``) correctly beat their general parents
// (``MINIMAX_``). New providers should be added here so they get their
// own card in Settings → Keys instead of being lumped into "Other".
interface ProviderPrefix {
  prefix: string
  name: string
  /** Optional one-line tagline shown beneath the group name. */
  description?: string
  /** Optional canonical signup/console URL surfaced from the card header. */
  docsUrl?: string
  /** Lower numbers float to the top of the providers list. */
  priority: number
}

export const EMPTY_SELECT_VALUE = '__hermes_empty__'
export const CONTROL_TEXT = 'text-xs'

export const PROVIDER_GROUPS: ProviderPrefix[] = [
  {
    prefix: 'NOUS_',
    name: 'Nous Portal',
    description: '托管的 Herbound 与 Nous 系列模型',
    docsUrl: 'https://portal.nousresearch.com',
    priority: 0
  },
  {
    prefix: 'OPENROUTER_',
    name: 'OpenRouter',
    description: '聚合数百个前沿模型的服务',
    docsUrl: 'https://openrouter.ai/keys',
    priority: 1
  },
  {
    prefix: 'ANTHROPIC_',
    name: 'Anthropic',
    description: 'Claude API 访问能力，包括 Sonnet、Opus、Haiku',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    priority: 2
  },
  {
    prefix: 'XAI_',
    name: 'xAI',
    description: 'Grok 模型，SuperGrok / Premium+ 建议使用 OAuth',
    docsUrl: 'https://console.x.ai/',
    priority: 3
  },
  {
    prefix: 'GOOGLE_',
    name: 'Gemini',
    description: 'Google AI Studio，支持 Gemini 1.5 / 2.0 / 2.5',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    priority: 4
  },
  { prefix: 'GEMINI_', name: 'Gemini', priority: 4 },
  { prefix: 'HERMES_GEMINI_', name: 'Gemini', priority: 4 },
  {
    prefix: 'DEEPSEEK_',
    name: 'DeepSeek',
    description: 'DeepSeek 官方 API，支持 V3.x、R1',
    docsUrl: 'https://platform.deepseek.com/api_keys',
    priority: 5
  },
  {
    prefix: 'DEEPSEEN_',
    name: 'DeepSeen',
    description: 'DeepSeen 跨境工具服务，用于商品、达人、竞品、图片和视频生成分析',
    docsUrl: 'https://deepseen.ai/',
    priority: 5.5
  },
  {
    prefix: 'DASHSCOPE_',
    name: 'DashScope (Qwen)',
    description: '阿里云百炼 DashScope，支持通义千问和多厂商模型',
    docsUrl: 'https://modelstudio.console.alibabacloud.com/',
    priority: 6
  },
  { prefix: 'HERMES_QWEN_', name: 'DashScope (Qwen)', priority: 6 },
  {
    prefix: 'GLM_',
    name: 'GLM / Z.AI',
    description: '智谱 GLM-4.6 和 Z.AI 托管接口',
    docsUrl: 'https://z.ai/',
    priority: 7
  },
  { prefix: 'ZAI_', name: 'GLM / Z.AI', priority: 7 },
  { prefix: 'Z_AI_', name: 'GLM / Z.AI', priority: 7 },
  {
    prefix: 'KIMI_',
    name: 'Kimi / Moonshot',
    description: 'Moonshot Kimi K2 与代码模型接口',
    docsUrl: 'https://platform.moonshot.cn/',
    priority: 8
  },
  {
    prefix: 'KIMI_CN_',
    name: 'Kimi (China)',
    description: 'Moonshot 国内接口',
    docsUrl: 'https://platform.moonshot.cn/',
    priority: 9
  },
  {
    prefix: 'MINIMAX_',
    name: 'MiniMax',
    description: 'MiniMax-M2 与海螺国际接口',
    docsUrl: 'https://www.minimax.io/',
    priority: 10
  },
  {
    prefix: 'MINIMAX_CN_',
    name: 'MiniMax (China)',
    description: 'MiniMax 国内接口',
    docsUrl: 'https://www.minimaxi.com/',
    priority: 11
  },
  {
    prefix: 'HF_',
    name: 'Hugging Face',
    description: 'Hugging Face 推理服务，通过 router.huggingface.co 访问多个开源模型',
    docsUrl: 'https://huggingface.co/settings/tokens',
    priority: 12
  },
  {
    prefix: 'OPENCODE_ZEN_',
    name: 'OpenCode Zen',
    description: '按量付费使用精选代码模型',
    docsUrl: 'https://opencode.ai/auth',
    priority: 13
  },
  {
    prefix: 'OPENCODE_GO_',
    name: 'OpenCode Go',
    description: '订阅制使用开放代码模型',
    docsUrl: 'https://opencode.ai/auth',
    priority: 14
  },
  {
    prefix: 'NVIDIA_',
    name: 'NVIDIA NIM',
    description: '使用 build.nvidia.com 或自建本地 NIM 接口',
    docsUrl: 'https://build.nvidia.com/',
    priority: 15
  },
  {
    prefix: 'OLLAMA_',
    name: 'Ollama Cloud',
    description: 'ollama.com 托管的云端开放模型',
    docsUrl: 'https://ollama.com/settings',
    priority: 16
  },
  {
    prefix: 'LM_',
    name: 'LM Studio',
    description: '本地 LM Studio 服务，兼容 OpenAI 接口',
    docsUrl: 'https://lmstudio.ai/docs/local-server',
    priority: 17
  },
  {
    prefix: 'STEPFUN_',
    name: 'StepFun',
    description: '阶跃星辰 Step Plan 代码模型',
    docsUrl: 'https://platform.stepfun.com/',
    priority: 18
  },
  {
    prefix: 'XIAOMI_',
    name: 'Xiaomi MiMo',
    description: 'MiMo-V2.5 与小米自研模型',
    docsUrl: 'https://platform.xiaomimimo.com',
    priority: 19
  },
  {
    prefix: 'ARCEEAI_',
    name: 'Arcee AI',
    description: 'Arcee 托管的小型和中型模型',
    docsUrl: 'https://chat.arcee.ai/',
    priority: 20
  },
  { prefix: 'ARCEE_', name: 'Arcee AI', priority: 20 },
  {
    prefix: 'GMI_',
    name: 'GMI Cloud',
    description: 'GMI Cloud GPU 与模型服务',
    docsUrl: 'https://www.gmicloud.ai/',
    priority: 21
  },
  {
    prefix: 'AZURE_FOUNDRY_',
    name: 'Azure Foundry',
    description: 'Azure AI Foundry 自定义接口，兼容 OpenAI / Anthropic',
    docsUrl: 'https://ai.azure.com/',
    priority: 22
  },
  {
    prefix: 'AWS_',
    name: 'AWS Bedrock',
    description: '通过 AWS 配置档和区域进行认证',
    docsUrl: 'https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-regions.html',
    priority: 23
  }
]

export const BUILTIN_PERSONALITIES = [
  'helpful',
  'concise',
  'technical',
  'creative',
  'teacher',
  'kawaii',
  'catgirl',
  'pirate',
  'shakespeare',
  'surfer',
  'noir',
  'uwu',
  'philosopher',
  'hype'
]

// Schema-side select overrides for desktop-relevant enum fields whose
// backend schema only declares a string type.
export const ENUM_OPTIONS: Record<string, string[]> = {
  'agent.image_input_mode': ['auto', 'native', 'text'],
  'approvals.mode': ['manual', 'smart', 'off'],
  'code_execution.mode': ['project', 'strict'],
  'context.engine': ['compressor', 'default', 'custom'],
  'delegation.reasoning_effort': ['', 'minimal', 'low', 'medium', 'high', 'xhigh'],
  'memory.provider': ['', 'builtin', 'honcho'],
  // Terminal execution backends — kept in sync with the dispatch ladder in
  // tools/terminal_tool.py::_create_environment (local/docker/singularity/
  // modal/daytona/ssh). Remote backends need extra env (image, tokens, host).
  'terminal.backend': ['local', 'docker', 'singularity', 'modal', 'daytona', 'ssh'],
  'stt.elevenlabs.model_id': ['scribe_v2', 'scribe_v1'],
  'stt.local.model': ['tiny', 'base', 'small', 'medium', 'large-v3'],
  // Speech-to-text backends — kept in sync with the stt block in
  // hermes_cli/config.py (local/groq/openai/mistral/elevenlabs).
  'stt.provider': ['local', 'groq', 'openai', 'mistral', 'xai', 'elevenlabs'],
  'tts.openai.voice': ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
  // Text-to-speech backends — kept in sync with the built-in source of truth
  // (agent/tts_registry.py::_BUILTIN_NAMES / tools/tts_tool.py::
  // BUILTIN_TTS_PROVIDERS). 'xai' is Grok TTS.
  'tts.provider': [
    'edge',
    'elevenlabs',
    'openai',
    'xai',
    'minimax',
    'mistral',
    'gemini',
    'neutts',
    'kittentts',
    'piper'
  ],
  'stt.openai.model': ['whisper-1', 'gpt-4o-mini-transcribe', 'gpt-4o-transcribe'],
  'stt.mistral.model': ['voxtral-mini-latest', 'voxtral-mini-2602'],
  'tts.openai.model': ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'],
  'tts.elevenlabs.model_id': ['eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2_5'],
  // NeuTTS local inference device.
  'tts.neutts.device': ['cpu', 'cuda', 'mps'],
  'updates.non_interactive_local_changes': ['stash', 'discard']
}

export const FIELD_LABELS: Record<string, string> = defineFieldCopy({
  model: '默认模型',
  modelContextLength: '上下文窗口',
  fallbackProviders: '备用模型',
  toolsets: '已启用工具集',
  timezone: '时区',
  display: {
    personality: '助手风格',
    showReasoning: '推理过程'
  },
  agent: {
    maxTurns: '最大执行步数',
    imageInputMode: '图片附件处理',
    apiMaxRetries: '接口重试次数',
    serviceTier: '服务等级',
    toolUseEnforcement: '工具调用约束'
  },
  terminal: {
    cwd: '工作目录',
    backend: '执行后端',
    timeout: '命令超时时间',
    persistentShell: '保持终端会话',
    envPassthrough: '透传环境变量',
    dockerImage: 'Docker 镜像',
    singularityImage: 'Singularity 镜像',
    modalImage: 'Modal 镜像',
    daytonaImage: 'Daytona 镜像'
  },
  fileReadMaxChars: '文件读取上限',
  toolOutput: {
    maxBytes: '终端输出上限',
    maxLines: '文件分页上限',
    maxLineLength: '单行长度上限'
  },
  codeExecution: {
    mode: '代码执行模式'
  },
  approvals: {
    mode: '审批模式',
    timeout: '审批超时时间',
    mcpReloadConfirm: '确认 MCP 重新加载'
  },
  commandAllowlist: '命令白名单',
  security: {
    redactSecrets: '隐藏敏感密钥',
    allowPrivateUrls: '允许访问内网地址'
  },
  browser: {
    allowPrivateUrls: '浏览器允许内网地址',
    autoLocalForPrivateUrls: '内网地址使用本地浏览器'
  },
  checkpoints: {
    enabled: '文件快照',
    maxSnapshots: '快照数量上限'
  },
  voice: {
    recordKey: '语音快捷键',
    maxRecordingSeconds: '最长录音时长',
    autoTts: '自动朗读回复'
  },
  stt: {
    enabled: '语音转文字',
    provider: '语音识别服务',
    local: {
      model: '本地转写模型',
      language: '转写语言'
    },
    openai: {
      model: 'OpenAI STT Model'
    },
    groq: {
      model: 'Groq STT Model'
    },
    mistral: {
      model: 'Mistral STT Model'
    },
    elevenlabs: {
      modelId: 'ElevenLabs STT Model',
      languageCode: 'ElevenLabs 语言',
      tagAudioEvents: '标记音频事件',
      diarize: '说话人分离'
    }
  },
  tts: {
    provider: '文字转语音服务',
    edge: {
      voice: 'Edge 音色'
    },
    openai: {
      model: 'OpenAI TTS Model',
      voice: 'OpenAI 音色'
    },
    elevenlabs: {
      voiceId: 'ElevenLabs 音色',
      modelId: 'ElevenLabs Model'
    },
    xai: {
      voiceId: 'xAI 音色',
      language: 'xAI 语言'
    },
    minimax: {
      model: 'MiniMax TTS Model',
      voiceId: 'MiniMax 音色'
    },
    mistral: {
      model: 'Mistral TTS Model',
      voiceId: 'Mistral 音色'
    },
    gemini: {
      model: 'Gemini TTS Model',
      voice: 'Gemini 音色'
    },
    neutts: {
      model: 'NeuTTS Model',
      device: 'NeuTTS 运行设备'
    },
    kittentts: {
      model: 'KittenTTS Model',
      voice: 'KittenTTS 音色'
    },
    piper: {
      voice: 'Piper 音色'
    }
  },
  memory: {
    memoryEnabled: '长期记忆',
    userProfileEnabled: '用户画像',
    memoryCharLimit: '记忆容量',
    userCharLimit: '画像容量',
    provider: '记忆服务'
  },
  context: {
    engine: '上下文引擎'
  },
  compression: {
    enabled: '自动压缩',
    threshold: '压缩阈值',
    targetRatio: '压缩目标比例',
    protectLastN: '保护最近消息数'
  },
  delegation: {
    model: '子智能体模型',
    provider: '子智能体服务商',
    maxIterations: '子智能体轮次上限',
    maxConcurrentChildren: '并行子智能体数量',
    childTimeoutSeconds: '子智能体超时时间',
    reasoningEffort: '子智能体推理强度'
  },
  updates: {
    nonInteractiveLocalChanges: '应用内更新遇到本地改动时'
  }
})

export const FIELD_DESCRIPTIONS: Record<string, string> = defineFieldCopy({
  model: '新对话默认使用的模型，也可以在输入框上方临时切换。',
  modelContextLength: '填 0 时自动使用当前模型检测到的上下文窗口。',
  fallbackProviders: '默认模型失败时依次尝试的备用服务商和模型。',
  display: {
    personality: '新会话默认使用的助手表达风格。',
    showReasoning: '当后端返回推理内容时，在对话中展示推理区块。'
  },
  timezone: 'Herbound 需要本地时间上下文时使用，留空则使用系统时区。',
  agent: {
    imageInputMode: '控制图片附件如何发送给模型。',
    maxTurns: '单次任务中工具调用和模型思考的最大步数。'
  },
  terminal: {
    cwd: '工具和终端默认使用的项目目录。',
    persistentShell: '后端支持时，在多次命令之间保留终端状态。',
    envPassthrough: '传递给工具执行环境的环境变量。',
    dockerImage: '执行后端为 Docker 时使用的容器镜像。',
    singularityImage: '执行后端为 Singularity 时使用的镜像。',
    modalImage: '执行后端为 Modal 时使用的镜像。',
    daytonaImage: '执行后端为 Daytona 时使用的镜像。'
  },
  codeExecution: {
    mode: '控制代码执行是否严格限制在当前项目范围内。'
  },
  fileReadMaxChars: '单次读取文件时最多允许读取的字符数。',
  approvals: {
    mode: 'Herbound 遇到需要确认的命令时如何处理。',
    timeout: '审批提示等待用户确认的最长时间。'
  },
  security: {
    redactSecrets: '尽量从模型可见内容中隐藏检测到的密钥。'
  },
  checkpoints: {
    enabled: '在修改文件前创建可回滚快照。'
  },
  memory: {
    memoryEnabled: '保存可长期复用的记忆，帮助后续会话。',
    userProfileEnabled: '维护简短的用户偏好画像。'
  },
  context: {
    engine: '长对话接近上下文上限时的处理策略。'
  },
  compression: {
    enabled: '对话变长后自动压缩较早的上下文。'
  },
  voice: {
    autoTts: '自动朗读智能体回复。'
  },
  tts: {
    xai: {
      voiceId: 'xAI 音色 ID，例如 eve，也可以填写自定义音色 ID。',
      language: '朗读语言代码，例如 zh 或 en。'
    },
    neutts: {
      device: 'NeuTTS 本地推理使用的设备。'
    }
  },
  stt: {
    enabled: '启用本地或云端语音转文字。',
    elevenlabs: {
      languageCode: '可选 ISO-639-3 语言代码，留空则自动识别。'
    }
  },
  updates: {
    nonInteractiveLocalChanges:
      '应用内自动更新时，如果检测到本地源码改动，是先暂存保留还是直接丢弃。终端更新仍会询问。'
  }
})

// Curated desktop config surface: only fields a user might tune from the app.
export const SECTIONS: DesktopConfigSection[] = [
  {
    id: 'model',
    label: '模型',
    icon: Sparkles,
    keys: ['model_context_length', 'fallback_providers']
  },
  {
    id: 'chat',
    label: '对话',
    icon: MessageCircle,
    keys: ['display.personality', 'timezone', 'display.show_reasoning', 'agent.image_input_mode']
  },
  {
    id: 'appearance',
    label: '外观',
    icon: Palette,
    keys: []
  },
  {
    id: 'workspace',
    label: '工作区',
    icon: Monitor,
    keys: [
      'terminal.cwd',
      'code_execution.mode',
      'terminal.persistent_shell',
      'terminal.env_passthrough',
      'file_read_max_chars'
    ]
  },
  {
    id: 'safety',
    label: '安全',
    icon: Lock,
    keys: [
      'approvals.mode',
      'approvals.timeout',
      'approvals.mcp_reload_confirm',
      'command_allowlist',
      'security.redact_secrets',
      'security.allow_private_urls',
      'browser.allow_private_urls',
      'browser.auto_local_for_private_urls',
      'checkpoints.enabled'
    ]
  },
  {
    id: 'memory',
    label: '记忆与上下文',
    icon: Brain,
    keys: [
      'memory.memory_enabled',
      'memory.user_profile_enabled',
      'memory.memory_char_limit',
      'memory.user_char_limit',
      'memory.provider',
      'context.engine',
      'compression.enabled',
      'compression.threshold',
      'compression.target_ratio',
      'compression.protect_last_n'
    ]
  },
  {
    id: 'voice',
    label: '语音',
    icon: Mic,
    keys: [
      'tts.provider',
      'stt.enabled',
      'stt.provider',
      'voice.auto_tts',
      'tts.edge.voice',
      'tts.openai.model',
      'tts.openai.voice',
      'tts.elevenlabs.voice_id',
      'tts.elevenlabs.model_id',
      'tts.xai.voice_id',
      'tts.xai.language',
      'tts.minimax.model',
      'tts.minimax.voice_id',
      'tts.mistral.model',
      'tts.mistral.voice_id',
      'tts.gemini.model',
      'tts.gemini.voice',
      'tts.neutts.model',
      'tts.neutts.device',
      'tts.kittentts.model',
      'tts.kittentts.voice',
      'tts.piper.voice',
      'stt.local.model',
      'stt.local.language',
      'stt.openai.model',
      'stt.groq.model',
      'stt.mistral.model',
      'stt.elevenlabs.model_id',
      'stt.elevenlabs.language_code',
      'stt.elevenlabs.tag_audio_events',
      'stt.elevenlabs.diarize',
      'voice.record_key',
      'voice.max_recording_seconds'
    ]
  },
  {
    id: 'advanced',
    label: '高级',
    icon: Wrench,
    keys: [
      'toolsets',
      'terminal.backend',
      'terminal.timeout',
      'terminal.docker_image',
      'terminal.singularity_image',
      'terminal.modal_image',
      'terminal.daytona_image',
      'tool_output.max_bytes',
      'tool_output.max_lines',
      'tool_output.max_line_length',
      'checkpoints.max_snapshots',
      'agent.max_turns',
      'agent.api_max_retries',
      'agent.service_tier',
      'agent.tool_use_enforcement',
      'delegation.model',
      'delegation.provider',
      'delegation.max_iterations',
      'delegation.max_concurrent_children',
      'delegation.child_timeout_seconds',
      'delegation.reasoning_effort',
      'updates.non_interactive_local_changes'
    ]
  }
]

export interface ModeOption {
  id: ThemeMode
  label: string
  icon: IconComponent
}

export const MODE_OPTIONS: ModeOption[] = [
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'dark', label: '深色', icon: Moon },
  { id: 'system', label: '跟随系统', icon: Monitor }
]
