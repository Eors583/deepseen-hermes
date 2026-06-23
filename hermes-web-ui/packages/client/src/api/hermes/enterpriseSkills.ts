import { request } from '../client'

export interface EnterpriseSkillVersion {
  id: string
  version: number
  status: string
  content_md: string
  content_sha256?: string
  changelog?: string | null
  created_at: number
  reviewed_at?: number | null
  published_at?: number | null
}

export interface EnterpriseVisibilityRule {
  id?: string
  scope_type: string
  scope_id: string
  access_level: string
}

export interface EnterpriseSkillFile {
  id: string
  path: string
  file_kind: string
  content_text?: string | null
  object_url?: string | null
  mime_type?: string | null
  created_at?: number
}

export interface EnterpriseSkill {
  id: string
  name: string
  display_name: string
  description?: string | null
  category?: string | null
  business_domain?: string | null
  status: string
  latest_version_id?: string | null
  published_version_id?: string | null
  latest_version?: EnterpriseSkillVersion | null
  published_version?: EnterpriseSkillVersion | null
  versions?: EnterpriseSkillVersion[]
  visibility_rules?: EnterpriseVisibilityRule[]
  files?: EnterpriseSkillFile[]
  usage_count?: number
  last_used_at?: number | null
  updated_at: number
}

export interface EnterpriseSkillListResponse {
  skills: EnterpriseSkill[]
  total?: number
  page?: number
  page_size?: number
}

export interface EnterpriseSkillProposal {
  id: string
  title: string
  description?: string | null
  suggested_name?: string | null
  suggested_category?: string | null
  content_md: string
  status: string
  source_type: string
  source_session_id?: string | null
  proposed_by: string
  reviewer_id?: string | null
  review_comment?: string | null
  created_at: number
  reviewed_at?: number | null
  suggested_scope?: EnterpriseVisibilityRule | Record<string, unknown> | null
}

export interface EnterpriseSkillUsageEvent {
  id: string
  skill_id: string
  skill_version_id?: string | null
  user_id?: string | null
  session_id?: string | null
  status?: string | null
  created_at: number
}

export interface EnterpriseSkillFeedback {
  id: string
  skill_id: string
  skill_version_id?: string | null
  user_id?: string | null
  rating?: number | null
  comment?: string | null
  status: string
  created_at: number
}

export interface EnterpriseSkillAuditLog {
  id: string
  actor_user_id?: string | null
  action: string
  target_type: string
  target_id: string
  before_json?: string | null
  after_json?: string | null
  created_at: number
}

export interface GovernanceFinding {
  severity: string
  rule_id: string
  message: string
  field?: string
  suggestion?: string
}

export interface EnterpriseSnapshot {
  snapshot_id: string
  snapshot_hash: string
  runtime_skills_dir: string
  skill_count: number
  skill_ids: string[]
  version_ids: string[]
}

export interface EnterpriseSkillListOptions {
  status?: string
  category?: string
  keyword?: string
  scope?: string
  page?: number
  page_size?: number
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export async function fetchEnterpriseSkills(options: EnterpriseSkillListOptions = {}): Promise<EnterpriseSkillListResponse> {
  return request<EnterpriseSkillListResponse>(`/api/enterprise/skills${qs(options)}`)
}

export async function fetchEnterpriseSkill(skillId: string): Promise<EnterpriseSkill> {
  const res = await request<{ skill: EnterpriseSkill }>(`/api/enterprise/skills/${skillId}`)
  return res.skill
}

export async function createEnterpriseSkill(input: {
  name: string
  display_name?: string
  description?: string
  category?: string
  business_domain?: string
  content_md: string
  visibility?: EnterpriseVisibilityRule[]
  publish?: boolean
}): Promise<EnterpriseSkill> {
  const res = await request<{ skill: EnterpriseSkill }>('/api/enterprise/skills', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return res.skill
}

export async function updateEnterpriseSkillDraft(skillId: string, input: {
  content_md: string
  changelog?: string
}): Promise<EnterpriseSkill> {
  const res = await request<{ skill: EnterpriseSkill }>(`/api/enterprise/skills/${skillId}/draft`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  return res.skill
}

export async function submitEnterpriseSkillReview(skillId: string): Promise<EnterpriseSkill> {
  const res = await request<{ skill: EnterpriseSkill }>(`/api/enterprise/skills/${skillId}/submit-review`, { method: 'POST' })
  return res.skill
}

export async function approveEnterpriseSkill(skillId: string): Promise<EnterpriseSkill> {
  const res = await request<{ skill: EnterpriseSkill }>(`/api/enterprise/skills/${skillId}/approve`, { method: 'POST' })
  return res.skill
}

export async function rejectEnterpriseSkill(skillId: string, review_comment?: string): Promise<EnterpriseSkill> {
  const res = await request<{ skill: EnterpriseSkill }>(`/api/enterprise/skills/${skillId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ review_comment }),
  })
  return res.skill
}

export async function publishEnterpriseSkill(skillId: string): Promise<EnterpriseSkill> {
  const res = await request<{ skill: EnterpriseSkill }>(`/api/enterprise/skills/${skillId}/publish`, { method: 'POST' })
  return res.skill
}

export async function rollbackEnterpriseSkill(skillId: string, targetVersionId: string): Promise<EnterpriseSkill> {
  const res = await request<{ skill: EnterpriseSkill }>(`/api/enterprise/skills/${skillId}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ target_version_id: targetVersionId }),
  })
  return res.skill
}

export async function archiveEnterpriseSkill(skillId: string): Promise<void> {
  await request(`/api/enterprise/skills/${skillId}/archive`, { method: 'POST' })
}

export async function replaceEnterpriseSkillVisibility(skillId: string, rules: EnterpriseVisibilityRule[]): Promise<EnterpriseVisibilityRule[]> {
  const res = await request<{ rules: EnterpriseVisibilityRule[] }>(`/api/enterprise/skills/${skillId}/visibility`, {
    method: 'PUT',
    body: JSON.stringify({ rules }),
  })
  return res.rules
}

export async function upsertEnterpriseSkillFile(skillId: string, input: {
  path: string
  file_kind: string
  content_text?: string
  object_url?: string
  mime_type?: string
}): Promise<EnterpriseSkillFile> {
  const res = await request<{ file: EnterpriseSkillFile }>(`/api/enterprise/skills/${skillId}/files`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return res.file
}

export async function deleteEnterpriseSkillFile(fileId: string): Promise<void> {
  await request(`/api/enterprise/skills/files/${fileId}`, { method: 'DELETE' })
}

export async function fetchEnterpriseSkillUsage(skillId?: string): Promise<EnterpriseSkillUsageEvent[]> {
  const res = await request<{ events: EnterpriseSkillUsageEvent[] }>(`/api/enterprise/skills/usage${qs({ skill_id: skillId })}`)
  return res.events
}

export async function fetchEnterpriseSkillFeedback(skillId?: string): Promise<EnterpriseSkillFeedback[]> {
  const res = await request<{ feedback: EnterpriseSkillFeedback[] }>(`/api/enterprise/skills/feedback${qs({ skill_id: skillId })}`)
  return res.feedback
}

export async function createEnterpriseSkillFeedback(input: {
  skill_id: string
  skill_version_id?: string
  rating?: number
  comment?: string
  status?: string
}): Promise<EnterpriseSkillFeedback> {
  const res = await request<{ feedback: EnterpriseSkillFeedback }>('/api/enterprise/skills/feedback', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return res.feedback
}

export async function fetchEnterpriseSkillAudit(targetId?: string): Promise<EnterpriseSkillAuditLog[]> {
  const res = await request<{ logs: EnterpriseSkillAuditLog[] }>(`/api/enterprise/skills/audit${qs({ target_id: targetId })}`)
  return res.logs
}

export async function fetchAvailableEnterpriseSkills(input: {
  profile_id?: string
  session_id?: string
  include_snapshot?: boolean
} = {}): Promise<{ skills: EnterpriseSkill[]; snapshot?: EnterpriseSnapshot; snapshot_hash?: string; locked_version_ids?: string[] }> {
  return request(`/api/enterprise/skills/available${qs(input)}`)
}

export async function fetchEnterpriseSkillProposals(status?: string): Promise<EnterpriseSkillProposal[]> {
  const res = await request<{ proposals: EnterpriseSkillProposal[] }>(`/api/enterprise/skills/proposals${qs({ status })}`)
  return res.proposals
}

export async function scanEnterpriseSkillGovernance(content_md: string): Promise<GovernanceFinding[]> {
  const res = await request<{ findings: GovernanceFinding[] }>('/api/enterprise/skills/governance/scan', {
    method: 'POST',
    body: JSON.stringify({ content_md }),
  })
  return res.findings
}

export async function createEnterpriseSkillProposal(input: {
  title: string
  content_md: string
  source_type?: string
  source_session_id?: string
  description?: string
  suggested_name?: string
  suggested_category?: string
  source_summary?: string
  suggested_scope?: EnterpriseVisibilityRule
}): Promise<EnterpriseSkillProposal> {
  const res = await request<{ proposal: EnterpriseSkillProposal }>('/api/enterprise/skills/proposals', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return res.proposal
}

export async function approveEnterpriseSkillProposal(proposalId: string, review_comment?: string): Promise<EnterpriseSkillProposal> {
  const res = await request<{ proposal: EnterpriseSkillProposal }>(`/api/enterprise/skills/proposals/${proposalId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ review_comment }),
  })
  return res.proposal
}

export async function rejectEnterpriseSkillProposal(proposalId: string, review_comment?: string): Promise<EnterpriseSkillProposal> {
  const res = await request<{ proposal: EnterpriseSkillProposal }>(`/api/enterprise/skills/proposals/${proposalId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ review_comment }),
  })
  return res.proposal
}

export async function convertEnterpriseSkillProposal(proposalId: string, input: {
  name?: string
  display_name?: string
  publish?: boolean
} = {}): Promise<{ proposal: EnterpriseSkillProposal; skill: EnterpriseSkill }> {
  return request(`/api/enterprise/skills/proposals/${proposalId}/convert`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
