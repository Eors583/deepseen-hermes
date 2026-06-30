import { JsonRpcGatewayClient } from '@hermes/shared'

import { getStoredAuthToken, isAuthTokenExpired } from '@/lib/auth-token'
import { filterDeepseenProductionModelOptions } from '@/lib/production-model-filter'
import type {
  ActionResponse,
  ActionStatusResponse,
  AnalyticsResponse,
  AudioSpeakResponse,
  AudioTranscriptionResponse,
  AuthMeResponse,
  AuthTokenResponse,
  AuxiliaryModelsResponse,
  BackendUpdateCheckResponse,
  ConfigSchemaResponse,
  CronJob,
  CronJobCreatePayload,
  CronJobUpdates,
  DeepSeenKeyStatus,
  ElevenLabsVoicesResponse,
  EnvVarInfo,
  HermesConfig,
  HermesConfigRecord,
  LogsResponse,
  MessagingPlatformsResponse,
  MessagingPlatformTestResponse,
  MessagingPlatformUpdate,
  ModelAssignmentRequest,
  ModelAssignmentResponse,
  ModelInfoResponse,
  ModelOptionsResponse,
  OAuthPollResponse,
  OAuthProvidersResponse,
  OAuthStartResponse,
  OAuthSubmitResponse,
  PaginatedSessions,
  ProfileCreatePayload,
  ProfileSetupCommand,
  ProfileSoul,
  ProfilesResponse,
  SessionInfo,
  SessionMessagesResponse,
  SessionSearchResponse,
  SkillInfo,
  StatusResponse,
  ToolsetConfig,
  ToolsetInfo
} from '@/types/hermes'

const DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS = 30_000
const SESSION_LIST_REQUEST_TIMEOUT_MS = 60_000
const PUBLIC_AUTH_API_PATHS = new Set(['/api/auth/login', '/api/auth/register', '/api/status'])
const DEEPSEEN_ACCESS_TOKEN_KEY = 'viralforge_access_token'
const DEEPSEEN_REFRESH_TOKEN_KEY = 'viralforge_refresh_token'

interface DesktopApiRequest {
  path: string
  method?: string
  body?: unknown
  timeoutMs?: number
  authToken?: string
  profile?: string | null
}

function desktopApi<T>(request: DesktopApiRequest): Promise<T> {
  const token = request.authToken || (PUBLIC_AUTH_API_PATHS.has(request.path) ? '' : getStoredAuthToken() || '')
  return window.hermesDesktop.api<T>({
    ...request,
    ...(token ? { authToken: token } : {})
  })
}

function getStoredDeepSeenAccessToken(): string | null {
  try {
    const token = window.localStorage.getItem(DEEPSEEN_ACCESS_TOKEN_KEY)
    return token && !isAuthTokenExpired(token) ? token : null
  } catch {
    return null
  }
}

function persistDeepSeenTokens(accessToken?: string | null, refreshToken?: string | null): void {
  try {
    if (accessToken && accessToken.trim()) {
      window.localStorage.setItem(DEEPSEEN_ACCESS_TOKEN_KEY, accessToken.trim())
    }
    if (refreshToken && refreshToken.trim()) {
      window.localStorage.setItem(DEEPSEEN_REFRESH_TOKEN_KEY, refreshToken.trim())
    }
  } catch {
    // DeepSeen token persistence is best-effort; Deepseen login remains the primary gate.
  }
}

export type {
  ActionResponse,
  ActionStatusResponse,
  AnalyticsDailyEntry,
  AnalyticsModelEntry,
  AnalyticsResponse,
  AnalyticsSkillEntry,
  AnalyticsSkillsSummary,
  AnalyticsTotals,
  AudioSpeakResponse,
  AudioTranscriptionResponse,
  AuthMeResponse,
  AuthTokenResponse,
  AuthUser,
  AuxiliaryModelsResponse,
  BackendUpdateCheckResponse,
  ConfigFieldSchema,
  ConfigSchemaResponse,
  CronJob,
  CronJobCreatePayload,
  CronJobSchedule,
  CronJobUpdates,
  DeepSeenKeyStatus,
  ElevenLabsVoice,
  ElevenLabsVoicesResponse,
  EnvVarInfo,
  GatewayReadyPayload,
  HermesConfig,
  HermesConfigRecord,
  LogsResponse,
  MessagingEnvVarInfo,
  MessagingHomeChannel,
  MessagingPlatformInfo,
  MessagingPlatformsResponse,
  MessagingPlatformTestResponse,
  MessagingPlatformUpdate,
  ModelAssignmentRequest,
  ModelAssignmentResponse,
  ModelInfoResponse,
  ModelOptionProvider,
  ModelOptionsResponse,
  PaginatedSessions,
  ProfileCreatePayload,
  ProfileInfo,
  ProfileSetupCommand,
  ProfileSoul,
  ProfilesResponse,
  RpcEvent,
  SessionCreateResponse,
  SessionInfo,
  SessionMessage,
  SessionMessagesResponse,
  SessionResumeResponse,
  SessionRuntimeInfo,
  SessionSearchResponse,
  SessionSearchResult,
  SkillInfo,
  StaleAuxAssignment,
  StatusResponse,
  ToolsetConfig,
  ToolsetInfo
} from '@/types/hermes'

export class HermesGateway extends JsonRpcGatewayClient {
  constructor() {
    super({
      closedErrorMessage: 'Deepseen gateway connection closed',
      connectErrorMessage: 'Could not connect to Deepseen gateway',
      createRequestId: nextId => nextId,
      notConnectedErrorMessage: 'Deepseen gateway is not connected',
      requestTimeoutMs: DEFAULT_GATEWAY_REQUEST_TIMEOUT_MS
    })
  }
}

// Profile that profile-scoped REST settings (config/env/skills/tools/model/etc.)
// should target. Mirrors $activeGatewayProfile, pushed in from the store via
// setApiRequestProfile so this module needs no store import (avoids a cycle).
// Electron main consumes request.profile to pick which backend *process* serves
// the call; each pooled backend already has its own HERMES_HOME, so no backend
// change is needed. Null means primary, so single-profile users are unaffected.
let _apiProfile: null | string = null

export function setApiRequestProfile(profile: null | string): void {
  _apiProfile = profile || null
}

function profileScoped(): { profile?: string } {
  return _apiProfile ? { profile: _apiProfile } : {}
}

export async function listSessions(
  limit = 40,
  minMessages = 0,
  archived: 'exclude' | 'include' | 'only' = 'exclude',
  order: 'created' | 'recent' = 'recent'
): Promise<PaginatedSessions> {
  const result = await desktopApi<PaginatedSessions>({
    path: `/api/sessions?limit=${limit}&offset=0&min_messages=${Math.max(0, minMessages)}&archived=${archived}&order=${order}`,
    timeoutMs: SESSION_LIST_REQUEST_TIMEOUT_MS
  })

  return {
    ...result,
    sessions: result.sessions.slice(0, limit),
    offset: 0
  }
}

// Unified, read-only session list aggregated across ALL profiles. Served by the
// primary backend straight off each profile's state.db; no per-profile backend
// is spawned. Single-profile users get the same rows as listSessions(), tagged
// profile="default".
// Source scoping lets callers split the unified list into independent slices:
// recents pass `excludeSources: ['cron']`, the cron-jobs section passes
// `source: 'cron'`. Without this a burst of (always-newest) cron sessions
// consumes the whole recents page and starves real conversations.
export interface SessionSourceFilter {
  source?: string
  excludeSources?: string[]
}

export async function listAllProfileSessions(
  limit = 40,
  minMessages = 0,
  archived: 'exclude' | 'include' | 'only' = 'exclude',
  order: 'created' | 'recent' = 'recent',
  profile: 'all' | (string & {}) = 'all',
  filter: SessionSourceFilter = {}
): Promise<PaginatedSessions> {
  const sourceParam = filter.source ? `&source=${encodeURIComponent(filter.source)}` : ''

  const excludeParam = filter.excludeSources?.length
    ? `&exclude_sources=${encodeURIComponent(filter.excludeSources.join(','))}`
    : ''

  const result = await desktopApi<PaginatedSessions>({
    path:
      `/api/profiles/sessions?limit=${limit}&offset=0&min_messages=${Math.max(0, minMessages)}` +
      `&archived=${archived}&order=${order}&profile=${encodeURIComponent(profile)}${sourceParam}${excludeParam}`,
    timeoutMs: SESSION_LIST_REQUEST_TIMEOUT_MS
  })

  return {
    ...result,
    sessions: result.sessions.slice(0, limit),
    offset: 0
  }
}

// Mutations take the owning `profile` so Electron routes them to that profile's
// backend (remote pool or local primary) via request.profile, matching the
// read path. A remote session's row lives only on its remote host, so a mutation
// that hit the local primary would no-op or 404. Omit for the current/default.
export function setSessionArchived(id: string, archived: boolean, profile?: string | null): Promise<{ ok: boolean }> {
  return desktopApi<{ ok: boolean }>({
    ...(profile ? { profile } : {}),
    path: `/api/sessions/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: { archived }
  })
}

export function searchSessions(query: string): Promise<SessionSearchResponse> {
  return desktopApi<SessionSearchResponse>({
    path: `/api/sessions/search?q=${encodeURIComponent(query)}`
  })
}

// Reads another profile's transcript. For a remote profile Electron reroutes
// this GET to the remote backend (which serves its own state.db); for a local
// profile the primary opens that profile's state.db via ?profile=. Omit for
// the current/default profile.
export function getSessionMessages(id: string, profile?: string | null): Promise<SessionMessagesResponse> {
  const suffix = profile ? `?profile=${encodeURIComponent(profile)}` : ''

  return desktopApi<SessionMessagesResponse>({
    ...(profile ? { profile } : {}),
    path: `/api/sessions/${encodeURIComponent(id)}/messages${suffix}`
  })
}

export function deleteSession(id: string, profile?: string | null): Promise<{ ok: boolean }> {
  return desktopApi<{ ok: boolean }>({
    ...(profile ? { profile } : {}),
    path: `/api/sessions/${encodeURIComponent(id)}`,
    method: 'DELETE'
  })
}

export function renameSession(
  id: string,
  title: string,
  profile?: string | null
): Promise<{ ok: boolean; title: string }> {
  return desktopApi<{ ok: boolean; title: string }>({
    ...(profile ? { profile } : {}),
    path: `/api/sessions/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: { title, ...(profile ? { profile } : {}) }
  })
}

export function getGlobalModelInfo(): Promise<ModelInfoResponse> {
  return desktopApi<ModelInfoResponse>({
    ...profileScoped(),
    path: '/api/model/info'
  })
}

export function getStatus(): Promise<StatusResponse> {
  return desktopApi<StatusResponse>({
    path: '/api/status'
  })
}

export async function loginUser(username: string, password: string): Promise<AuthTokenResponse> {
  const result = await desktopApi<AuthTokenResponse>({
    path: '/api/auth/login',
    method: 'POST',
    body: { username, password }
  })

  try {
    const email = username.trim().toLowerCase()
    const deepseenLogin = await window.hermesDesktop.deepseenRequest<DeepSeenApiEnvelope<{
      accessToken?: string
      refreshToken?: string
    }>>({
      path: 'auth/login',
      method: 'POST',
      body: { email, password },
      timeoutMs: 60_000
    })
    const tokens = unwrapDeepSeenResponse(deepseenLogin)
    persistDeepSeenTokens(tokens.accessToken, tokens.refreshToken)
    console.info(`[deepseen-auth] synced DeepSeen access token=${tokens.accessToken ? `yes len=${tokens.accessToken.length}` : 'no'}`)
  } catch (error) {
    console.warn(`[deepseen-auth] failed to sync DeepSeen token: ${error instanceof Error ? error.message : String(error)}`)
  }

  return result
}

export function registerUser(username: string, password: string): Promise<AuthTokenResponse> {
  return desktopApi<AuthTokenResponse>({
    path: '/api/auth/register',
    method: 'POST',
    body: { username, password }
  })
}

export function getCurrentAuthUser(authToken: string): Promise<AuthMeResponse> {
  return desktopApi<AuthMeResponse>({
    path: '/api/auth/me',
    authToken
  })
}

export function getLogs(params: {
  component?: string
  file?: string
  level?: string
  lines?: number
}): Promise<LogsResponse> {
  const query = new URLSearchParams()

  if (params.file) {
    query.set('file', params.file)
  }

  if (typeof params.lines === 'number') {
    query.set('lines', String(params.lines))
  }

  if (params.level && params.level !== 'ALL') {
    query.set('level', params.level)
  }

  if (params.component && params.component !== 'all') {
    query.set('component', params.component)
  }

  const suffix = query.toString()

  return desktopApi<LogsResponse>({
    ...profileScoped(),
    path: suffix ? `/api/logs?${suffix}` : '/api/logs'
  })
}

export function getHermesConfig(): Promise<HermesConfig> {
  return desktopApi<HermesConfig>({
    ...profileScoped(),
    path: '/api/config'
  })
}

export function getHermesConfigRecord(): Promise<HermesConfigRecord> {
  return desktopApi<HermesConfigRecord>({
    ...profileScoped(),
    path: '/api/config'
  })
}

export function getHermesConfigDefaults(): Promise<HermesConfigRecord> {
  return desktopApi<HermesConfigRecord>({
    ...profileScoped(),
    path: '/api/config/defaults'
  })
}

export function getHermesConfigSchema(): Promise<ConfigSchemaResponse> {
  return desktopApi<ConfigSchemaResponse>({
    ...profileScoped(),
    path: '/api/config/schema'
  })
}

export function saveHermesConfig(config: HermesConfigRecord): Promise<{ ok: boolean }> {
  return desktopApi<{ ok: boolean }>({
    ...profileScoped(),
    path: '/api/config',
    method: 'PUT',
    body: { config }
  })
}

export function getEnvVars(): Promise<Record<string, EnvVarInfo>> {
  return desktopApi<Record<string, EnvVarInfo>>({
    ...profileScoped(),
    path: '/api/env'
  })
}

export function setEnvVar(key: string, value: string): Promise<{ ok: boolean }> {
  return desktopApi<{ ok: boolean }>({
    ...profileScoped(),
    path: '/api/env',
    method: 'PUT',
    body: { key, value }
  })
}

export function getDeepSeenKeyStatus(): Promise<DeepSeenKeyStatus> {
  return desktopApi<DeepSeenKeyStatus>({
    ...profileScoped(),
    path: '/api/hermes/deepseen-key'
  })
}

export function setDeepSeenApiKey(apiKey: string): Promise<DeepSeenKeyStatus & { ok: boolean }> {
  return desktopApi<DeepSeenKeyStatus & { ok: boolean }>({
    ...profileScoped(),
    path: '/api/hermes/deepseen-key',
    method: 'PUT',
    body: { api_key: apiKey }
  })
}

export function deleteDeepSeenApiKey(): Promise<DeepSeenKeyStatus & { ok: boolean }> {
  return desktopApi<DeepSeenKeyStatus & { ok: boolean }>({
    ...profileScoped(),
    path: '/api/hermes/deepseen-key',
    method: 'DELETE'
  })
}

export function validateProviderCredential(
  key: string,
  value: string,
  apiKey?: string
): Promise<{ ok: boolean; reachable: boolean; message: string; models?: string[] }> {
  return desktopApi<{ ok: boolean; reachable: boolean; message: string; models?: string[] }>({
    ...profileScoped(),
    path: '/api/providers/validate',
    method: 'POST',
    body: { key, value, api_key: apiKey ?? '' }
  })
}

export function deleteEnvVar(key: string): Promise<{ ok: boolean }> {
  return desktopApi<{ ok: boolean }>({
    ...profileScoped(),
    path: '/api/env',
    method: 'DELETE',
    body: { key }
  })
}

export function revealEnvVar(key: string): Promise<{ key: string; value: string }> {
  return desktopApi<{ key: string; value: string }>({
    ...profileScoped(),
    path: '/api/env/reveal',
    method: 'POST',
    body: { key }
  })
}

export function listOAuthProviders(): Promise<OAuthProvidersResponse> {
  return desktopApi<OAuthProvidersResponse>({
    ...profileScoped(),
    path: '/api/providers/oauth'
  })
}

export function startOAuthLogin(providerId: string): Promise<OAuthStartResponse> {
  return desktopApi<OAuthStartResponse>({
    ...profileScoped(),
    path: `/api/providers/oauth/${encodeURIComponent(providerId)}/start`,
    method: 'POST',
    body: {}
  })
}

export function submitOAuthCode(providerId: string, sessionId: string, code: string): Promise<OAuthSubmitResponse> {
  return desktopApi<OAuthSubmitResponse>({
    ...profileScoped(),
    path: `/api/providers/oauth/${encodeURIComponent(providerId)}/submit`,
    method: 'POST',
    body: { session_id: sessionId, code }
  })
}

export function pollOAuthSession(providerId: string, sessionId: string): Promise<OAuthPollResponse> {
  return desktopApi<OAuthPollResponse>({
    ...profileScoped(),
    path: `/api/providers/oauth/${encodeURIComponent(providerId)}/poll/${encodeURIComponent(sessionId)}`
  })
}

export function cancelOAuthSession(sessionId: string): Promise<{ ok: boolean }> {
  return desktopApi<{ ok: boolean }>({
    ...profileScoped(),
    path: `/api/providers/oauth/sessions/${encodeURIComponent(sessionId)}`,
    method: 'DELETE'
  })
}

export function getSkills(): Promise<SkillInfo[]> {
  return desktopApi<SkillInfo[]>({
    ...profileScoped(),
    path: '/api/skills'
  })
}

export function toggleSkill(name: string, enabled: boolean): Promise<{ ok: boolean; name: string; enabled: boolean }> {
  return desktopApi<{ ok: boolean; name: string; enabled: boolean }>({
    ...profileScoped(),
    path: '/api/skills/toggle',
    method: 'PUT',
    body: { name, enabled }
  })
}

export function getToolsets(): Promise<ToolsetInfo[]> {
  return desktopApi<ToolsetInfo[]>({
    ...profileScoped(),
    path: '/api/tools/toolsets'
  })
}

export function toggleToolset(
  name: string,
  enabled: boolean
): Promise<{ ok: boolean; name: string; enabled: boolean }> {
  return desktopApi<{ ok: boolean; name: string; enabled: boolean }>({
    ...profileScoped(),
    path: `/api/tools/toolsets/${encodeURIComponent(name)}`,
    method: 'PUT',
    body: { enabled }
  })
}

export function getToolsetConfig(name: string): Promise<ToolsetConfig> {
  return desktopApi<ToolsetConfig>({
    ...profileScoped(),
    path: `/api/tools/toolsets/${encodeURIComponent(name)}/config`
  })
}

export function selectToolsetProvider(
  name: string,
  provider: string
): Promise<{ ok: boolean; name: string; provider: string }> {
  return desktopApi<{ ok: boolean; name: string; provider: string }>({
    ...profileScoped(),
    path: `/api/tools/toolsets/${encodeURIComponent(name)}/provider`,
    method: 'PUT',
    body: { provider }
  })
}

export function runToolsetPostSetup(name: string, key: string): Promise<ActionResponse & { key: string }> {
  return desktopApi<ActionResponse & { key: string }>({
    ...profileScoped(),
    path: `/api/tools/toolsets/${encodeURIComponent(name)}/post-setup`,
    method: 'POST',
    body: { key }
  })
}

export function getMessagingPlatforms(): Promise<MessagingPlatformsResponse> {
  return desktopApi<MessagingPlatformsResponse>({
    path: '/api/messaging/platforms'
  })
}

export function updateMessagingPlatform(
  platformId: string,
  body: MessagingPlatformUpdate
): Promise<{ ok: boolean; platform: string }> {
  return desktopApi<{ ok: boolean; platform: string }>({
    path: `/api/messaging/platforms/${encodeURIComponent(platformId)}`,
    method: 'PUT',
    body
  })
}

export function testMessagingPlatform(platformId: string): Promise<MessagingPlatformTestResponse> {
  return desktopApi<MessagingPlatformTestResponse>({
    path: `/api/messaging/platforms/${encodeURIComponent(platformId)}/test`,
    method: 'POST'
  })
}

export function getCronJobs(): Promise<CronJob[]> {
  return desktopApi<CronJob[]>({
    path: '/api/cron/jobs'
  })
}

export function getCronJob(jobId: string): Promise<CronJob> {
  return desktopApi<CronJob>({
    path: `/api/cron/jobs/${encodeURIComponent(jobId)}`
  })
}

export async function getCronJobRuns(jobId: string, limit = 20): Promise<SessionInfo[]> {
  const { runs } = await desktopApi<{ runs: SessionInfo[] }>({
    path: `/api/cron/jobs/${encodeURIComponent(jobId)}/runs?limit=${limit}`
  })

  return runs ?? []
}

export function createCronJob(body: CronJobCreatePayload): Promise<CronJob> {
  return desktopApi<CronJob>({
    path: '/api/cron/jobs',
    method: 'POST',
    body
  })
}

export function updateCronJob(jobId: string, updates: CronJobUpdates): Promise<CronJob> {
  return desktopApi<CronJob>({
    path: `/api/cron/jobs/${encodeURIComponent(jobId)}`,
    method: 'PUT',
    body: { updates }
  })
}

export function pauseCronJob(jobId: string): Promise<CronJob> {
  return desktopApi<CronJob>({
    path: `/api/cron/jobs/${encodeURIComponent(jobId)}/pause`,
    method: 'POST'
  })
}

export function resumeCronJob(jobId: string): Promise<CronJob> {
  return desktopApi<CronJob>({
    path: `/api/cron/jobs/${encodeURIComponent(jobId)}/resume`,
    method: 'POST'
  })
}

export function triggerCronJob(jobId: string): Promise<CronJob> {
  return desktopApi<CronJob>({
    path: `/api/cron/jobs/${encodeURIComponent(jobId)}/trigger`,
    method: 'POST'
  })
}

export function deleteCronJob(jobId: string): Promise<{ ok: boolean }> {
  return desktopApi<{ ok: boolean }>({
    path: `/api/cron/jobs/${encodeURIComponent(jobId)}`,
    method: 'DELETE'
  })
}

export function getProfiles(): Promise<ProfilesResponse> {
  return desktopApi<ProfilesResponse>({
    path: '/api/profiles'
  })
}

export function createProfile(body: ProfileCreatePayload): Promise<{ name: string; ok: boolean; path: string }> {
  return desktopApi<{ name: string; ok: boolean; path: string }>({
    path: '/api/profiles',
    method: 'POST',
    body
  })
}

export function renameProfile(name: string, newName: string): Promise<{ name: string; ok: boolean; path: string }> {
  return desktopApi<{ name: string; ok: boolean; path: string }>({
    path: `/api/profiles/${encodeURIComponent(name)}`,
    method: 'PATCH',
    body: { new_name: newName }
  })
}

export function deleteProfile(name: string): Promise<{ ok: boolean; path: string }> {
  return desktopApi<{ ok: boolean; path: string }>({
    path: `/api/profiles/${encodeURIComponent(name)}`,
    method: 'DELETE'
  })
}

export function getProfileSoul(name: string): Promise<ProfileSoul> {
  return desktopApi<ProfileSoul>({
    path: `/api/profiles/${encodeURIComponent(name)}/soul`
  })
}

export function updateProfileSoul(name: string, content: string): Promise<{ ok: boolean }> {
  return desktopApi<{ ok: boolean }>({
    path: `/api/profiles/${encodeURIComponent(name)}/soul`,
    method: 'PUT',
    body: { content }
  })
}

export function getProfileSetupCommand(name: string): Promise<ProfileSetupCommand> {
  return desktopApi<ProfileSetupCommand>({
    path: `/api/profiles/${encodeURIComponent(name)}/setup-command`
  })
}

export function getUsageAnalytics(days = 30): Promise<AnalyticsResponse> {
  return desktopApi<AnalyticsResponse>({
    ...profileScoped(),
    path: `/api/analytics/usage?days=${Math.max(1, Math.floor(days))}`
  })
}

export function getGlobalModelOptions(): Promise<ModelOptionsResponse> {
  return desktopApi<ModelOptionsResponse>({
    ...profileScoped(),
    path: '/api/model/options'
  }).then(options => filterDeepseenProductionModelOptions(options) ?? options)
}

export interface RecommendedDefaultModel {
  provider: string
  model: string
  /** True/false for Nous (free vs paid tier); null for other providers. */
  free_tier: boolean | null
}

// Recommended default model for a freshly-authenticated provider. Mirrors the
// curation `hermes model` does; for Nous it honors the free/paid tier so a
// free user gets a free model instead of a paid default.
export function getRecommendedDefaultModel(provider: string): Promise<RecommendedDefaultModel> {
  return desktopApi<RecommendedDefaultModel>({
    ...profileScoped(),
    path: `/api/model/recommended-default?provider=${encodeURIComponent(provider)}`
  })
}

export function setGlobalModel(
  provider: string,
  model: string
): Promise<{ ok: boolean; provider: string; model: string }> {
  return desktopApi<{ ok: boolean; provider: string; model: string }>({
    ...profileScoped(),
    path: '/api/model/set',
    method: 'POST',
    body: {
      scope: 'main',
      provider,
      model
    }
  })
}

export function getAuxiliaryModels(): Promise<AuxiliaryModelsResponse> {
  return desktopApi<AuxiliaryModelsResponse>({
    ...profileScoped(),
    path: '/api/model/auxiliary'
  })
}

export function setModelAssignment(body: ModelAssignmentRequest): Promise<ModelAssignmentResponse> {
  return desktopApi<ModelAssignmentResponse>({
    ...profileScoped(),
    path: '/api/model/set',
    method: 'POST',
    body
  })
}

export function restartGateway(): Promise<ActionResponse> {
  return desktopApi<ActionResponse>({
    path: '/api/gateway/restart',
    method: 'POST'
  })
}

export function updateHermes(): Promise<ActionResponse> {
  return desktopApi<ActionResponse>({
    path: '/api/hermes/update',
    method: 'POST'
  })
}

/** Query the connected backend's own update state. In remote mode this is the
 *  authoritative source for the backend's behind-count + "what's changed",
 *  distinct from the Electron client clone's git state. */
export function checkHermesUpdate(force = false): Promise<BackendUpdateCheckResponse> {
  return desktopApi<BackendUpdateCheckResponse>({
    path: `/api/hermes/update/check${force ? '?force=true' : ''}`
  })
}

export function getActionStatus(name: string, lines = 200): Promise<ActionStatusResponse> {
  return desktopApi<ActionStatusResponse>({
    path: `/api/actions/${encodeURIComponent(name)}/status?lines=${Math.max(1, lines)}`
  })
}

export function transcribeAudio(dataUrl: string, mimeType?: string): Promise<AudioTranscriptionResponse> {
  return desktopApi<AudioTranscriptionResponse>({
    path: '/api/audio/transcribe',
    method: 'POST',
    body: {
      data_url: dataUrl,
      mime_type: mimeType
    }
  })
}

export function speakText(text: string): Promise<AudioSpeakResponse> {
  return desktopApi<AudioSpeakResponse>({
    path: '/api/audio/speak',
    method: 'POST',
    body: { text }
  })
}

export function getElevenLabsVoices(): Promise<ElevenLabsVoicesResponse> {
  return desktopApi<ElevenLabsVoicesResponse>({
    path: '/api/audio/elevenlabs/voices'
  })
}

export interface DeepSeenApiEnvelope<T = unknown> {
  data?: T
  error?: {
    code?: string
    details?: unknown
    message?: string
  }
  success?: boolean
}

export interface DeepSeenTaskProgress {
  actionId?: string
  actionRequired?: {
    message?: string
    type?: string
  }
  error?: string
  fallback?: {
    message?: string
    title?: string
  }
  logs?: Array<{ message?: string; stage?: string; timestamp?: string } | string>
  message?: string
  progress?: number
  result?: Record<string, unknown>
  status: 'CANCELLED' | 'COMPLETED' | 'FAILED' | 'PENDING' | 'PROCESSING' | 'RUNNING' | string
  step?: string
  taskId?: string
}

export interface DeepSeenUploadResponse {
  url: string
}

export interface DeepSeenCreditBalance {
  freeCredits?: number
  frozenPersonalCredits?: number
  paidCredits?: number
  planTier?: string
  teamOwnerName?: string
}

type DeepSeenUploadType = 'analyze' | 'avatar' | 'common' | 'competitor' | 'recreation' | 'video-analysis'

export class DeepSeenApiError extends Error {
  code?: string
  details?: unknown
  statusCode?: number

  constructor(message: string, options: { code?: string; details?: unknown; statusCode?: number } = {}) {
    super(message)
    this.name = 'DeepSeenApiError'
    this.code = options.code
    this.details = options.details
    this.statusCode = options.statusCode
  }
}

function parseDeepSeenError(error: unknown): DeepSeenApiError {
  if (error instanceof DeepSeenApiError) return error
  const message = error instanceof Error ? error.message : String(error || 'DeepSeen 请求失败')
  const jsonStart = message.indexOf('{')
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(message.slice(jsonStart)) as DeepSeenApiEnvelope
      if (parsed?.error) {
        return new DeepSeenApiError(parsed.error.message || parsed.error.code || message, {
          code: parsed.error.code,
          details: parsed.error.details,
          statusCode: Number((error as { statusCode?: number })?.statusCode || 0) || undefined
        })
      }
    } catch {
      // Keep the original transport error below.
    }
  }
  return new DeepSeenApiError(message, {
    statusCode: Number((error as { statusCode?: number })?.statusCode || 0) || undefined
  })
}

export function unwrapDeepSeenResponse<T>(response: DeepSeenApiEnvelope<T>): T {
  if (response?.success === false) {
    throw new DeepSeenApiError(response.error?.message || response.error?.code || 'DeepSeen 请求失败', {
      code: response.error?.code,
      details: response.error?.details
    })
  }
  return (response?.data ?? response) as T
}
export async function deepseenRequest<T>(
  path: string,
  options: { body?: unknown; method?: string; timeoutMs?: number } = {}
): Promise<T> {
  try {
    const normalized = path.replace(/^\/+/, '')
    const token = getStoredDeepSeenAccessToken() || getStoredAuthToken() || undefined
    const request = {
      path: normalized,
      method: options.method || (options.body === undefined ? 'GET' : 'POST'),
      body: options.body,
      ...(token ? { authToken: token } : {}),
      timeoutMs: options.timeoutMs || 120_000
    }
    const response = window.hermesDesktop.deepseenRequest
      ? await window.hermesDesktop.deepseenRequest<DeepSeenApiEnvelope<T>>(request)
      : await desktopApi<DeepSeenApiEnvelope<T>>({
          ...request,
          path: `/api/deepseen/${normalized}`
        })
    return unwrapDeepSeenResponse<T>(response)
  } catch (error) {
    throw parseDeepSeenError(error)
  }
}

export function getDeepSeenCreditBalance(): Promise<DeepSeenCreditBalance> {
  return deepseenRequest<DeepSeenCreditBalance>('credits/balance', { timeoutMs: 30_000 })
}

export function uploadDeepSeenDataUrl(payload: {
  dataUrl: string
  filename: string
  type?: DeepSeenUploadType
}): Promise<DeepSeenUploadResponse> {
  return desktopApi<DeepSeenApiEnvelope<DeepSeenUploadResponse>>({
    path: '/api/deepseen/upload-data-url',
    method: 'POST',
    body: payload,
    timeoutMs: 180_000
  }).then(unwrapDeepSeenResponse)
}

export function uploadDeepSeenFile(payload: {
  filePath: string
  filename?: string
  type?: DeepSeenUploadType
}): Promise<DeepSeenUploadResponse> {
  const token = getStoredDeepSeenAccessToken() || getStoredAuthToken() || undefined
  return window.hermesDesktop
    .deepseenUploadFile<DeepSeenApiEnvelope<DeepSeenUploadResponse>>({
      ...payload,
      ...(token ? { authToken: token } : {}),
      timeoutMs: 300_000
    })
    .then(unwrapDeepSeenResponse)
}

export function analyzeDeepSeenAdDiagnosisFile<T = unknown>(payload: {
  fields: Record<string, string | number | boolean>
  filePath: string
  filename?: string
}): Promise<T> {
  const token = getStoredDeepSeenAccessToken() || getStoredAuthToken() || undefined
  return window.hermesDesktop
    .deepseenAdDiagnosisFile<DeepSeenApiEnvelope<T>>({
      ...payload,
      ...(token ? { authToken: token } : {}),
      timeoutMs: 300_000
    })
    .then(unwrapDeepSeenResponse)
}

export function streamDeepSeenTask(
  taskId: string,
  callbacks: {
    onComplete: (progress: DeepSeenTaskProgress) => void
    onError: (error: Error) => void
    onProgress: (progress: DeepSeenTaskProgress) => void
  }
): () => void {
  let disposed = false
  let eventSource: EventSource | null = null
  let pollTimer: number | null = null
  let completed = false

  const isDone = (progress: DeepSeenTaskProgress) => {
    const status = String(progress.status || '').toUpperCase()
    return status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED'
  }

  const emitProgress = (progress: DeepSeenTaskProgress) => {
    if (disposed || completed) return
    callbacks.onProgress(progress)
    if (isDone(progress)) {
      completed = true
      callbacks.onComplete(progress)
      eventSource?.close()
      if (pollTimer !== null) window.clearTimeout(pollTimer)
    }
  }

  const startPolling = () => {
    const tick = async () => {
      if (disposed || completed) return
      try {
        emitProgress(await getDeepSeenTaskStatus(taskId))
      } catch (error) {
        if (!disposed && !completed) callbacks.onError(error instanceof Error ? error : new Error(String(error)))
        return
      }
      if (!disposed && !completed) pollTimer = window.setTimeout(tick, 5000)
    }
    void tick()
  }

  const parseEvent = (event: Event) => {
    const data = (event as MessageEvent).data
    if (!data) return
    try {
      emitProgress(JSON.parse(data) as DeepSeenTaskProgress)
    } catch (error) {
      if (!disposed && !completed) callbacks.onError(error instanceof Error ? error : new Error('DeepSeen 任务进度解析失败'))
    }
  }

  const token = getStoredDeepSeenAccessToken() || getStoredAuthToken() || undefined
  if (!window.hermesDesktop.deepseenTaskStreamUrl || typeof EventSource === 'undefined') {
    startPolling()
  } else {
    window.hermesDesktop
      .deepseenTaskStreamUrl({ taskId, ...(token ? { authToken: token } : {}) })
      .then(({ url }) => {
        if (disposed || completed) return
        let opened = false
        eventSource = new EventSource(url)
        eventSource.onopen = () => {
          opened = true
        }
        eventSource.addEventListener('progress', parseEvent)
        eventSource.addEventListener('complete', parseEvent)
        eventSource.onerror = () => {
          eventSource?.close()
          if (disposed || completed) return
          if (!opened) {
            startPolling()
            return
          }
          callbacks.onError(new Error('DeepSeen 任务进度连接中断'))
        }
      })
      .catch(() => startPolling())
  }

  return () => {
    disposed = true
    eventSource?.close()
    if (pollTimer !== null) window.clearTimeout(pollTimer)
  }
}

export function getDeepSeenTaskStatus(taskId: string): Promise<DeepSeenTaskProgress> {
  return deepseenRequest<DeepSeenTaskProgress>(`tasks/${encodeURIComponent(taskId)}/status`, { timeoutMs: 60_000 })
}

export function cancelDeepSeenTask(taskId: string): Promise<void> {
  return deepseenRequest<void>(`tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', body: {} })
}

export function confirmDeepSeenTaskFallback(taskId: string): Promise<void> {
  return deepseenRequest<void>(`tasks/${encodeURIComponent(taskId)}/fallback/confirm`, {
    method: 'POST',
    body: { decision: 'continue' }
  })
}

