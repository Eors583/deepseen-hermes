import { HermesGatewayClient, type GatewayEvent } from '@/api/native/hermesGateway'
import { fetchSessionMessagesPage } from '@/api/hermes/sessions'
import { getAuthUserId } from '@/api/client'

export type ContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      name: string
      path: string
      media_type: string
      resource_url?: string
      resource_file_id?: string
      resource_purpose?: string
      resource_content_type?: string
    }
  | {
      type: 'file'
      name: string
      path: string
      media_type?: string
      resource_url?: string
      resource_file_id?: string
      resource_purpose?: string
      resource_content_type?: string
    }

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentBlock[]
}

export interface StartRunRequest {
  input: string | ContentBlock[]
  instructions?: string
  session_id?: string
  profile?: string
  model?: string
  provider?: string
  model_groups?: Array<{ provider: string; models: string[] }>
  queue_id?: string
  source?: 'api_server' | 'cli' | 'coding_agent'
  coding_agent_id?: 'claude-code' | 'codex'
  agent_id?: 'claude-code' | 'codex'
  mode?: 'scoped' | 'global'
  workspace?: string | null
  baseUrl?: string
  base_url?: string
  apiKey?: string
  api_key?: string
  apiMode?: 'chat_completions' | 'codex_responses' | 'anthropic_messages'
  api_mode?: 'chat_completions' | 'codex_responses' | 'anthropic_messages'
  reasoning_effort?: string
}

export interface StartRunResponse {
  run_id: string
  status: string
}

export interface RunEvent {
  event: string
  run_id?: string
  delta?: string
  text?: string
  tool?: string
  name?: string
  preview?: string
  timestamp?: number
  error?: string
  output?: string | null
  usage?: {
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  session_id?: string
  title?: string
  queue_length?: number
  dequeued_queue_id?: string
  queued_messages?: Array<{
    id?: string | number
    role?: string
    content?: string
    timestamp?: number
    queued?: boolean
  }>
  [key: string]: unknown
}

export interface ResumeSessionPayload {
  session_id: string
  messages: any[]
  messageTotal?: number
  messageLoadedCount?: number
  messagePageLimit?: number
  hasMoreBefore?: boolean
  isWorking: boolean
  isAborting?: boolean
  events: Array<{ event: string; data: RunEvent }>
  inputTokens?: number
  outputTokens?: number
  contextTokens?: number
  queueLength?: number
  queueMessages?: RunEvent['queued_messages']
}

type SessionHandlers = {
  onMessageDelta: (event: RunEvent) => void
  onReasoningDelta: (event: RunEvent) => void
  onThinkingDelta: (event: RunEvent) => void
  onReasoningAvailable: (event: RunEvent) => void
  onToolStarted: (event: RunEvent) => void
  onToolCompleted: (event: RunEvent) => void
  onSubagentEvent?: (event: RunEvent) => void
  onRunStarted: (event: RunEvent) => void
  onRunCompleted: (event: RunEvent) => void
  onRunFailed: (event: RunEvent) => void
  onCompressionStarted: (event: RunEvent) => void
  onCompressionCompleted: (event: RunEvent) => void
  onAbortStarted: (event: RunEvent) => void
  onAbortTimeout?: (event: RunEvent) => void
  onAbortCompleted: (event: RunEvent) => void
  onUsageUpdated: (event: RunEvent) => void
  onAgentEvent?: (event: RunEvent) => void
  onSessionCommand?: (event: RunEvent) => void
  onSessionTitleUpdated?: (event: RunEvent) => void
  onRunQueued?: (event: RunEvent) => void
  onApprovalRequested?: (event: RunEvent) => void
  onApprovalResolved?: (event: RunEvent) => void
  onPeerUserMessage?: (event: RunEvent) => void
  onClarifyRequested?: (event: RunEvent) => void
  onClarifyResolved?: (event: RunEvent) => void
}

type SocketHandler = (...args: any[]) => void

class NativeChatSocket {
  connected = false
  private handlers = new Map<string, Set<SocketHandler>>()

  on(event: string, handler: SocketHandler): this {
    let set = this.handlers.get(event)
    if (!set) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler)
    return this
  }

  off(event: string, handler: SocketHandler): this {
    this.handlers.get(event)?.delete(handler)
    return this
  }

  removeListener(event: string, handler: SocketHandler): this {
    return this.off(event, handler)
  }

  removeAllListeners(): this {
    this.handlers.clear()
    return this
  }

  disconnect(): this {
    disconnectChatRun()
    return this
  }

  emit(event: string, payload?: any): this {
    if (event === 'abort' && payload?.session_id) {
      void gateway.request('prompt.cancel', { session_id: payload.session_id }).catch(() => {
        dispatchToSession(payload.session_id, {
          event: 'abort.completed',
          session_id: payload.session_id,
          synced: false,
        })
      })
      return this
    }
    if (event === 'approval.respond' && payload?.session_id) {
      void gateway.request('approval.respond', payload).catch(() => {})
      return this
    }
    if (event === 'clarify.respond' && payload?.session_id) {
      void gateway.request('clarify.respond', payload).catch(() => {})
      return this
    }
    if (event === 'resume' && payload?.session_id) {
      this.emitLocal('resumed', makeEmptyResume(payload.session_id))
      return this
    }
    return this
  }

  emitLocal(event: string, payload?: any): void {
    for (const handler of this.handlers.get(event) || []) handler(payload)
  }
}

const gateway = new HermesGatewayClient()
const socketFacade = new NativeChatSocket()
const sessionEventHandlers = new Map<string, SessionHandlers>()
const peerUserMessageHandlers = new Set<(event: RunEvent) => void>()
const sessionCommandHandlers = new Set<(event: RunEvent) => void>()
const sessionTitleUpdatedHandlers = new Set<(event: RunEvent) => void>()

let activeProfile: string | null = null
let listenersBound = false
const completedOutputs = new Map<string, string>()

function isNativeSessionId(sessionId: string): boolean {
  return /^\d{8}_\d{6}_[a-z0-9]{6}$/i.test(sessionId)
}

export function resolveNativeSessionId(sessionId: string): string {
  return sessionId
}

export function createNativeSessionId(): string {
  const now = new Date()
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')
  return `${ts}_${Math.random().toString(16).slice(2, 8).padEnd(6, '0').slice(0, 6)}`
}

function inputToText(input: string | ContentBlock[]): string {
  if (typeof input === 'string') return input
  return input.map(block => {
    if (block.type === 'text') return block.text
    const resourceLines = [
      block.resource_url ? `Primary remote resource URL for tools: ${block.resource_url}` : '',
      block.resource_file_id ? `DeepSeen file_id: ${block.resource_file_id}` : '',
      block.resource_purpose ? `Resource purpose: ${block.resource_purpose}` : '',
      block.resource_content_type ? `Resource content type: ${block.resource_content_type}` : '',
    ].filter(Boolean)
    return [
      `[${block.type}: ${block.name}](${block.path})`,
      ...resourceLines,
    ].join('\n')
  }).filter(Boolean).join('\n')
}

function normalizeToolPayload(payload: Record<string, unknown> = {}): RunEvent {
  const name = String(payload.name || payload.tool || 'tool')
  return {
    event: '',
    tool: name,
    name,
    preview: String(payload.context || payload.args_text || payload.summary || ''),
    tool_call_id: payload.tool_call_id || name,
    arguments: payload.arguments || payload.args || payload.args_text,
    output: String(payload.result_text || payload.summary || payload.result || ''),
  }
}

function toRunEvent(event: GatewayEvent, fallbackType?: string): RunEvent {
  const payload = (event.payload || {}) as Record<string, unknown>
  const type = fallbackType || event.type
  if (type === 'message.delta') {
    return {
      event: 'message.delta',
      session_id: event.session_id,
      delta: String(payload.text || payload.delta || ''),
    }
  }
  if (type === 'message.complete') {
    const output = String(payload.text || payload.output || completedOutputs.get(event.session_id || '') || '')
    return {
      event: 'run.completed',
      session_id: event.session_id,
      run_id: String(payload.run_id || event.session_id || ''),
      output,
      parsed_content: output,
    }
  }
  if (type === 'tool.start' || type === 'tool.started') {
    return {
      ...normalizeToolPayload(payload),
      event: 'tool.started',
      session_id: event.session_id,
    }
  }
  if (type === 'tool.complete' || type === 'tool.completed') {
    return {
      ...normalizeToolPayload(payload),
      event: 'tool.completed',
      session_id: event.session_id,
    }
  }
  if (type === 'tool.progress') {
    const name = String(payload.tool_name || payload.name || payload.tool || 'tool')
    return {
      event: 'tool.progress',
      session_id: event.session_id,
      tool: name,
      name,
      preview: String(payload.preview || payload.text || payload.message || payload.status || ''),
      ...payload,
    }
  }
  if (type === 'error') {
    return {
      event: 'run.failed',
      session_id: event.session_id,
      error: String(payload.message || payload.error || 'Hermes gateway error'),
    }
  }
  return { event: type, session_id: event.session_id, ...payload }
}

function dispatchToSession(sessionId: string | undefined, event: RunEvent): void {
  if (!sessionId) return
  const handlers = sessionEventHandlers.get(sessionId)
  if (!handlers) return
  switch (event.event) {
    case 'message.delta':
      handlers.onMessageDelta(event)
      break
    case 'reasoning.delta':
      handlers.onReasoningDelta(event)
      break
    case 'thinking.delta':
      handlers.onThinkingDelta(event)
      break
    case 'reasoning.available':
      handlers.onReasoningAvailable(event)
      break
    case 'tool.started':
      handlers.onToolStarted(event)
      break
    case 'tool.completed':
      handlers.onToolCompleted(event)
      break
    case 'run.started':
      handlers.onRunStarted(event)
      break
    case 'run.completed':
      handlers.onRunCompleted(event)
      break
    case 'run.failed':
      handlers.onRunFailed(event)
      break
    case 'abort.started':
      handlers.onAbortStarted(event)
      break
    case 'abort.timeout':
      handlers.onAbortTimeout?.(event)
      break
    case 'abort.completed':
      handlers.onAbortCompleted(event)
      break
    case 'usage.updated':
      handlers.onUsageUpdated(event)
      break
    case 'session.title.updated':
      handlers.onSessionTitleUpdated?.(event)
      for (const handler of sessionTitleUpdatedHandlers) handler(event)
      break
    case 'session.command':
      handlers.onSessionCommand?.(event)
      for (const handler of sessionCommandHandlers) handler(event)
      break
    case 'approval.requested':
      handlers.onApprovalRequested?.(event)
      break
    case 'approval.resolved':
      handlers.onApprovalResolved?.(event)
      break
    case 'clarify.requested':
      handlers.onClarifyRequested?.(event)
      break
    case 'clarify.resolved':
      handlers.onClarifyResolved?.(event)
      break
    default:
      handlers.onAgentEvent?.(event)
  }
}

function bindGatewayListeners(): void {
  if (listenersBound) return
  listenersBound = true
  for (const type of ['message.delta', 'message.complete', 'tool.start', 'tool.complete', 'tool.started', 'tool.completed', 'tool.progress', 'error']) {
    gateway.on(type, event => {
      const runEvent = toRunEvent(event, type)
      if (runEvent.event === 'message.delta' && event.session_id) {
        completedOutputs.set(event.session_id, (completedOutputs.get(event.session_id) || '') + (runEvent.delta || ''))
      }
      dispatchToSession(event.session_id, runEvent)
    })
  }
}

async function nativeSessionFor(uiSessionId: string): Promise<string> {
  if (!isNativeSessionId(uiSessionId)) {
    throw new Error('Invalid Hermes native session id')
  }
  const created = await gateway.request<{ session_id: string }>('session.create', {
    session_id: uiSessionId,
    session_key: uiSessionId,
    title: 'Deepseen',
    close_on_disconnect: false,
    ...(getAuthUserId() ? { user_id: getAuthUserId() } : {}),
  })
  return created.session_id
}

async function recreateNativeSessionFor(uiSessionId: string): Promise<string> {
  if (!isNativeSessionId(uiSessionId)) {
    throw new Error('Invalid Hermes native session id')
  }
  const created = await gateway.request<{ session_id: string }>('session.create', {
    session_id: uiSessionId,
    session_key: uiSessionId,
    title: 'Deepseen',
    close_on_disconnect: false,
    ...(getAuthUserId() ? { user_id: getAuthUserId() } : {}),
  })
  return created.session_id
}

async function ensureConnected(profile?: string | null): Promise<void> {
  const requested = profile || null
  if (gateway.connected && (!requested || requested === activeProfile)) {
    socketFacade.connected = true
    return
  }
  if (gateway.connected && requested && requested !== activeProfile) {
    gateway.close()
  }
  await gateway.connect(requested || undefined)
  activeProfile = requested
  socketFacade.connected = true
  bindGatewayListeners()
}

function makeEmptyResume(sessionId: string): ResumeSessionPayload {
  return {
    session_id: sessionId,
    messages: [],
    isWorking: false,
    events: [],
    messageLoadedCount: 0,
    messageTotal: 0,
    hasMoreBefore: false,
    queueLength: 0,
  }
}

export function registerSessionHandlers(sessionId: string, handlers: SessionHandlers): () => void {
  sessionEventHandlers.set(sessionId, handlers)
  return () => sessionEventHandlers.delete(sessionId)
}

export function unregisterSessionHandlers(sessionId: string): void {
  sessionEventHandlers.delete(sessionId)
}

export function onPeerUserMessage(handler: (event: RunEvent) => void): () => void {
  peerUserMessageHandlers.add(handler)
  return () => peerUserMessageHandlers.delete(handler)
}

export function onSessionCommand(handler: (event: RunEvent) => void): () => void {
  sessionCommandHandlers.add(handler)
  return () => sessionCommandHandlers.delete(handler)
}

export function onSessionTitleUpdated(handler: (event: RunEvent) => void): () => void {
  sessionTitleUpdatedHandlers.add(handler)
  return () => sessionTitleUpdatedHandlers.delete(handler)
}

export function respondClarify(sessionId: string, clarifyId: string, response: string): void {
  socketFacade.emit('clarify.respond', { session_id: sessionId, clarify_id: clarifyId, response })
}

export function respondToolApproval(
  sessionId: string,
  approvalId: string,
  choice: 'once' | 'session' | 'always' | 'deny',
): void {
  socketFacade.emit('approval.respond', { session_id: sessionId, approval_id: approvalId, choice })
}

export function getChatRunSocket(): NativeChatSocket | null {
  return socketFacade
}

export function connectChatRun(requestedProfile?: string | null): NativeChatSocket {
  void ensureConnected(requestedProfile).catch(error => {
    socketFacade.emitLocal('connect_error', error)
  })
  return socketFacade
}

export function disconnectChatRun(): void {
  gateway.close()
  socketFacade.connected = false
  activeProfile = null
  sessionEventHandlers.clear()
}

export function resumeSession(
  sessionId: string,
  onResumed: (data: ResumeSessionPayload) => void,
  profile?: string | null,
): NativeChatSocket {
  void ensureConnected(profile).then(() => {
    return fetchSessionMessagesPage(resolveNativeSessionId(sessionId), 0, 300, profile)
  }).then(page => {
    if (!page) {
      onResumed(makeEmptyResume(sessionId))
      return
    }
    onResumed({
      session_id: sessionId,
      messages: page.messages || [],
      isWorking: false,
      events: [],
      messageLoadedCount: page.messages?.length || 0,
      messageTotal: page.total || 0,
      messagePageLimit: page.limit || 300,
      hasMoreBefore: !!page.hasMore,
      queueLength: 0,
    })
  }).catch(() => {
    onResumed(makeEmptyResume(sessionId))
  })
  return socketFacade
}

export function startRunViaSocket(
  body: StartRunRequest,
  onEvent: (event: RunEvent) => void,
  onDone: () => void,
  onError: (err: Error) => void,
  onStarted?: (runId: string) => void,
): { abort: () => void } {
  const sid = body.session_id
  if (!sid) throw new Error('session_id is required for startRunViaSocket')

  let closed = false
  const runId = `run-${Date.now().toString(36)}`
  sessionEventHandlers.set(sid, {
    onMessageDelta: onEvent,
    onReasoningDelta: onEvent,
    onThinkingDelta: onEvent,
    onReasoningAvailable: onEvent,
    onToolStarted: onEvent,
    onToolCompleted: onEvent,
    onSubagentEvent: onEvent,
    onRunStarted: onEvent,
    onRunCompleted: event => {
      onEvent(event)
      if (!closed) {
        closed = true
        sessionEventHandlers.delete(sid)
        onDone()
      }
    },
    onRunFailed: event => {
      onEvent(event)
      if (!closed) {
        closed = true
        sessionEventHandlers.delete(sid)
        onDone()
      }
    },
    onCompressionStarted: onEvent,
    onCompressionCompleted: onEvent,
    onAbortStarted: onEvent,
    onAbortTimeout: onEvent,
    onAbortCompleted: onEvent,
    onUsageUpdated: onEvent,
    onAgentEvent: onEvent,
    onSessionCommand: onEvent,
    onSessionTitleUpdated: onEvent,
    onRunQueued: onEvent,
    onApprovalRequested: onEvent,
    onApprovalResolved: onEvent,
    onClarifyRequested: onEvent,
    onClarifyResolved: onEvent,
  })

  void (async () => {
    try {
      await ensureConnected(body.profile)
      const started: RunEvent = { event: 'run.started', session_id: sid, run_id: runId }
      onEvent(started)
      onStarted?.(runId)
      let nativeSid = await nativeSessionFor(sid)
      const text = inputToText(body.input)
      try {
        await gateway.request('prompt.submit', {
          session_id: nativeSid,
          text,
        })
      } catch (submitError) {
        if (!/session not found/i.test(String((submitError as Error)?.message || submitError))) {
          throw submitError
        }
        nativeSid = await recreateNativeSessionFor(sid)
        await gateway.request('prompt.submit', {
          session_id: nativeSid,
          text,
        })
      }
    } catch (error) {
      if (closed) return
      closed = true
      sessionEventHandlers.delete(sid)
      const err = error instanceof Error ? error : new Error(String(error))
      const failed: RunEvent = { event: 'run.failed', session_id: sid, run_id: runId, error: err.message }
      onEvent(failed)
      onError(err)
    }
  })()

  return {
    abort: () => {
      if (closed) return
      socketFacade.emit('abort', { session_id: sid })
      const aborted: RunEvent = { event: 'abort.completed', session_id: sid, run_id: runId, synced: true }
      onEvent(aborted)
      closed = true
      sessionEventHandlers.delete(sid)
      onDone()
    },
  }
}
