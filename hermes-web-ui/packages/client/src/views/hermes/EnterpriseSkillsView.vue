<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  approveEnterpriseSkill,
  archiveEnterpriseSkill,
  createEnterpriseSkill,
  createEnterpriseSkillFeedback,
  createEnterpriseSkillProposal,
  deleteEnterpriseSkillFile,
  fetchAvailableEnterpriseSkills,
  fetchEnterpriseSkill,
  fetchEnterpriseSkillAudit,
  fetchEnterpriseSkillFeedback,
  fetchEnterpriseSkillProposals,
  fetchEnterpriseSkillUsage,
  fetchEnterpriseSkills,
  publishEnterpriseSkill,
  replaceEnterpriseSkillVisibility,
  rollbackEnterpriseSkill,
  submitEnterpriseSkillReview,
  updateEnterpriseSkillDraft,
  upsertEnterpriseSkillFile,
  type EnterpriseSkill,
  type EnterpriseSkillAuditLog,
  type EnterpriseSkillFeedback,
  type EnterpriseSkillProposal,
  type EnterpriseSkillUsageEvent,
  type EnterpriseSnapshot,
  type EnterpriseVisibilityRule,
} from '@/api/hermes/enterpriseSkills'

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const skills = ref<EnterpriseSkill[]>([])
const proposals = ref<EnterpriseSkillProposal[]>([])
const usage = ref<EnterpriseSkillUsageEvent[]>([])
const feedback = ref<EnterpriseSkillFeedback[]>([])
const auditLogs = ref<EnterpriseSkillAuditLog[]>([])
const selected = ref<EnterpriseSkill | null>(null)
const snapshot = ref<EnterpriseSnapshot | null>(null)

const filters = reactive({ status: '', keyword: '', category: '' })
const editor = reactive({ content_md: '', changelog: '' })
const newVisibility = reactive<EnterpriseVisibilityRule>({ scope_type: 'organization', scope_id: 'default', access_level: 'use' })
const fileForm = reactive({ path: 'references/example.md', file_kind: 'reference', content_text: '', object_url: '', mime_type: 'text/markdown' })
const feedbackForm = reactive({ rating: 5, comment: '' })
const proposalForm = reactive({
  title: '',
  description: '',
  suggested_name: '',
  suggested_category: '',
  source_session_id: '',
  content_md: `---
name: proposed-enterprise-skill
description: Describe the repeatable business workflow.
---

# Proposed Enterprise Skill

Write the reusable workflow, inputs, tool usage rules, and output contract here.
`,
})
const form = reactive({
  name: '',
  display_name: '',
  description: '',
  category: '',
  business_domain: '',
  content_md: `---
name: example-enterprise-skill
description: Describe when this enterprise skill should be used.
---

# Example Enterprise Skill

Write the business workflow, required inputs, tool rules, and output rules here.
`,
  publish: true,
})

const publishedCount = computed(() => skills.value.filter(item => item.status === 'published').length)
const pendingProposalCount = computed(() => proposals.value.filter(item => item.status === 'pending').length)

function statusLabel(status: string) {
  const map: Record<string, string> = {
    draft: '草稿',
    review: '审核中',
    pending_review: '待审核',
    approved: '已通过',
    published: '已发布',
    archived: '已归档',
    rejected: '已拒绝',
    pending: '待审核',
    converted: '已转为 Skill',
    open: '待处理',
    resolved: '已处理',
  }
  return map[status] || status
}

function formatTime(value?: number | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function actionLabel(action: string) {
  const map: Record<string, string> = {
    'skill.create': '创建技能',
    'skill.draft.update': '更新草稿',
    'skill.submit_review': '提交审核',
    'skill.approve': '审核通过',
    'skill.publish': '发布技能',
    'skill.rollback': '回滚版本',
    'skill.archive': '归档技能',
    'skill.visibility.replace': '更新权限',
    'skill.file.upsert': '保存支持文件',
    'skill.file.delete': '删除支持文件',
    'skill.feedback.create': '创建反馈',
    'skill.proposal.create': '创建提案',
    'skill.proposal.approved': '提案通过',
    'skill.proposal.rejected': '提案拒绝',
    'skill.proposal.convert': '提案转技能',
  }
  return map[action] || action
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [skillRes, proposalRes, availableRes] = await Promise.all([
      fetchEnterpriseSkills({
        status: filters.status || undefined,
        keyword: filters.keyword || undefined,
        category: filters.category || undefined,
        page_size: 100,
      }),
      fetchEnterpriseSkillProposals(),
      fetchAvailableEnterpriseSkills({ session_id: 'enterprise_skills_page_preview', include_snapshot: true }),
    ])
    skills.value = skillRes.skills
    proposals.value = proposalRes
    snapshot.value = availableRes.snapshot || null
    if (selected.value) {
      const exists = skills.value.find(item => item.id === selected.value?.id)
      if (exists) await selectSkill(exists)
    }
  } catch (err: any) {
    error.value = err?.message || '加载企业技能失败'
  } finally {
    loading.value = false
  }
}

async function loadSideData(skillId?: string) {
  const [usageRes, feedbackRes, auditRes] = await Promise.all([
    fetchEnterpriseSkillUsage(skillId),
    fetchEnterpriseSkillFeedback(skillId),
    fetchEnterpriseSkillAudit(skillId),
  ])
  usage.value = usageRes
  feedback.value = feedbackRes
  auditLogs.value = auditRes
}

async function selectSkill(skill: EnterpriseSkill) {
  loading.value = true
  error.value = ''
  try {
    selected.value = await fetchEnterpriseSkill(skill.id)
    editor.content_md = selected.value.latest_version?.content_md || ''
    editor.changelog = ''
    await loadSideData(skill.id)
  } catch (err: any) {
    error.value = err?.message || '加载技能详情失败'
  } finally {
    loading.value = false
  }
}

async function runAction(action: () => Promise<unknown>, fallback: string, refreshSelected = true) {
  saving.value = true
  error.value = ''
  try {
    await action()
    await load()
    if (refreshSelected && selected.value) await selectSkill(selected.value)
  } catch (err: any) {
    error.value = err?.message || fallback
  } finally {
    saving.value = false
  }
}

async function createSkill() {
  if (!form.name.trim() || !form.content_md.trim()) {
    error.value = '请填写机器名和 SKILL.md 内容'
    return
  }
  await runAction(async () => {
    const skill = await createEnterpriseSkill({
      name: form.name.trim(),
      display_name: form.display_name.trim() || undefined,
      description: form.description.trim() || undefined,
      category: form.category.trim() || undefined,
      business_domain: form.business_domain.trim() || undefined,
      content_md: form.content_md,
      publish: form.publish,
    })
    Object.assign(form, { name: '', display_name: '', description: '', category: '', business_domain: '' })
    selected.value = skill
  }, '创建企业技能失败', false)
  if (selected.value) await selectSkill(selected.value)
}

async function saveDraft() {
  if (!selected.value) return
  await runAction(() => updateEnterpriseSkillDraft(selected.value!.id, {
    content_md: editor.content_md,
    changelog: editor.changelog || undefined,
  }), '保存草稿失败')
}

async function addVisibilityRule() {
  if (!selected.value) return
  const rules = [...(selected.value.visibility_rules || []), { ...newVisibility }]
  await runAction(() => replaceEnterpriseSkillVisibility(selected.value!.id, rules), '保存权限失败')
}

async function removeVisibilityRule(index: number) {
  if (!selected.value) return
  const rules = [...(selected.value.visibility_rules || [])]
  rules.splice(index, 1)
  await runAction(() => replaceEnterpriseSkillVisibility(selected.value!.id, rules), '删除权限失败')
}

async function saveSupportFile() {
  if (!selected.value) return
  await runAction(() => upsertEnterpriseSkillFile(selected.value!.id, {
    path: fileForm.path,
    file_kind: fileForm.file_kind,
    content_text: fileForm.content_text || undefined,
    object_url: fileForm.object_url || undefined,
    mime_type: fileForm.mime_type || undefined,
  }), '保存支持文件失败')
}

async function submitFeedback() {
  if (!selected.value) return
  await runAction(() => createEnterpriseSkillFeedback({
    skill_id: selected.value!.id,
    skill_version_id: selected.value!.published_version_id || selected.value!.latest_version_id || undefined,
    rating: Number(feedbackForm.rating) || undefined,
    comment: feedbackForm.comment || undefined,
    status: 'open',
  }), '提交反馈失败')
  feedbackForm.comment = ''
}

async function createProposal() {
  if (!proposalForm.title.trim() || !proposalForm.content_md.trim()) {
    error.value = '请填写提案标题和内容'
    return
  }
  await runAction(() => createEnterpriseSkillProposal({
    title: proposalForm.title.trim(),
    description: proposalForm.description.trim() || undefined,
    suggested_name: proposalForm.suggested_name.trim() || undefined,
    suggested_category: proposalForm.suggested_category.trim() || undefined,
    source_session_id: proposalForm.source_session_id.trim() || undefined,
    source_type: 'manual',
    content_md: proposalForm.content_md,
  }), '创建提案失败', false)
  Object.assign(proposalForm, { title: '', description: '', suggested_name: '', suggested_category: '', source_session_id: '' })
}

onMounted(async () => {
  await load()
  await loadSideData()
})
</script>

<template>
  <main class="enterprise-skills-page" data-testid="enterprise-skill-page">
    <header class="page-header">
      <div>
        <h1>企业 Skill 知识库</h1>
        <p>统一管理企业可复用技能，发布后的内容会按会话生成 runtime 快照供智能体读取。</p>
      </div>
      <button class="secondary-btn" :disabled="loading" @click="load">刷新</button>
    </header>

    <section class="summary-row">
      <div><span class="metric">{{ skills.length }}</span><span>总技能</span></div>
      <div><span class="metric">{{ publishedCount }}</span><span>已发布</span></div>
      <div><span class="metric">{{ pendingProposalCount }}</span><span>待审提案</span></div>
      <div><span class="metric">{{ snapshot?.skill_count ?? 0 }}</span><span>当前可用</span></div>
    </section>

    <p v-if="snapshot" class="snapshot-line">
      预览快照 {{ snapshot.snapshot_hash.slice(0, 12) }}，锁定 {{ snapshot.version_ids.length }} 个版本。
    </p>
    <p v-if="error" class="error">{{ error }}</p>

    <section class="filters">
      <input v-model="filters.keyword" placeholder="搜索名称、描述、业务域" @keydown.enter="load" />
      <input v-model="filters.category" placeholder="分类" @keydown.enter="load" />
      <select v-model="filters.status" @change="load">
        <option value="">全部状态</option>
        <option value="draft">草稿</option>
        <option value="review">审核中</option>
        <option value="published">已发布</option>
        <option value="archived">已归档</option>
      </select>
      <button class="secondary-btn" @click="load">筛选</button>
    </section>

    <section class="content-grid">
      <div class="panel">
        <h2>技能列表</h2>
        <div v-if="loading && skills.length === 0" class="empty">加载中...</div>
        <div v-else-if="skills.length === 0" class="empty">暂无企业技能</div>
        <article
          v-for="skill in skills"
          v-else
          :key="skill.id"
          class="skill-row"
          :class="{ active: selected?.id === skill.id }"
          role="button"
          tabindex="0"
          data-testid="enterprise-skill-row"
          @click="selectSkill(skill)"
          @keydown.enter.prevent="selectSkill(skill)"
          @keydown.space.prevent="selectSkill(skill)"
        >
          <div class="skill-main">
            <strong>{{ skill.display_name || skill.name }}</strong>
            <span>{{ skill.name }}</span>
            <p>{{ skill.description || '暂无描述' }}</p>
          </div>
          <div class="skill-meta">
            <span class="status" :class="skill.status">{{ statusLabel(skill.status) }}</span>
            <span>v{{ skill.published_version?.version || skill.latest_version?.version || '-' }}</span>
            <span>使用 {{ skill.usage_count || 0 }}</span>
          </div>
        </article>
      </div>

      <div class="panel detail-panel">
        <template v-if="selected">
          <div class="panel-title-row">
            <div>
              <h2>{{ selected.display_name || selected.name }}</h2>
              <p>{{ selected.name }} · {{ selected.business_domain || '未设置业务域' }}</p>
            </div>
            <span class="status" :class="selected.status">{{ statusLabel(selected.status) }}</span>
          </div>

          <div class="action-row">
            <button class="secondary-btn" :disabled="saving" @click="saveDraft">保存草稿</button>
            <button class="secondary-btn" data-testid="enterprise-skill-submit-review" :disabled="saving" @click="runAction(() => submitEnterpriseSkillReview(selected!.id), '提交审核失败')">提交审核</button>
            <button class="secondary-btn" data-testid="enterprise-skill-approve" :disabled="saving" @click="runAction(() => approveEnterpriseSkill(selected!.id), '审核通过失败')">审核通过</button>
            <button class="primary-btn" data-testid="enterprise-skill-publish" :disabled="saving" @click="runAction(() => publishEnterpriseSkill(selected!.id), '发布失败')">发布</button>
            <button class="danger-btn" :disabled="saving" @click="runAction(() => archiveEnterpriseSkill(selected!.id), '归档失败')">归档</button>
          </div>

          <label>修改说明<input v-model="editor.changelog" placeholder="本次更新说明" /></label>
          <label>SKILL.md<textarea v-model="editor.content_md" rows="16" /></label>

          <div class="subgrid">
            <section>
              <h3>版本记录</h3>
              <div v-for="version in selected.versions || []" :key="version.id" class="mini-row">
                <span>v{{ version.version }} · {{ statusLabel(version.status) }}</span>
                <span>{{ formatTime(version.published_at || version.created_at) }}</span>
                <button class="link-btn" data-testid="enterprise-skill-rollback" :disabled="saving || selected.published_version_id === version.id" @click="runAction(() => rollbackEnterpriseSkill(selected!.id, version.id), '回滚失败')">回滚</button>
              </div>
            </section>

            <section>
              <h3>权限范围</h3>
              <div v-for="(rule, index) in selected.visibility_rules || []" :key="`${rule.scope_type}:${rule.scope_id}:${rule.access_level}`" class="mini-row">
                <span>{{ rule.scope_type }} / {{ rule.scope_id }} / {{ rule.access_level }}</span>
                <button class="link-btn" @click="removeVisibilityRule(index)">删除</button>
              </div>
              <div class="inline-form">
                <select v-model="newVisibility.scope_type">
                  <option value="organization">组织</option>
                  <option value="team">团队</option>
                  <option value="user">用户</option>
                  <option value="role">角色</option>
                  <option value="profile">Profile</option>
                </select>
                <input v-model="newVisibility.scope_id" placeholder="范围 ID" />
                <select v-model="newVisibility.access_level">
                  <option value="view">查看</option>
                  <option value="use">使用</option>
                  <option value="edit">编辑</option>
                  <option value="approve">审核</option>
                  <option value="admin">管理</option>
                </select>
                <button class="secondary-btn" @click="addVisibilityRule">添加</button>
              </div>
            </section>
          </div>

          <section>
            <h3>支持文件</h3>
            <div v-for="file in selected.files || []" :key="file.id" class="mini-row">
              <span>{{ file.file_kind }} · {{ file.path }}</span>
              <button class="link-btn" @click="runAction(() => deleteEnterpriseSkillFile(file.id), '删除支持文件失败')">删除</button>
            </div>
            <div class="file-editor">
              <input v-model="fileForm.path" placeholder="references/example.md" />
              <select v-model="fileForm.file_kind">
                <option value="reference">reference</option>
                <option value="template">template</option>
                <option value="script">script</option>
                <option value="asset">asset</option>
              </select>
              <input v-model="fileForm.mime_type" placeholder="text/markdown" />
              <textarea v-model="fileForm.content_text" rows="5" placeholder="文件正文；如使用线上对象地址，可只填 URL" />
              <input v-model="fileForm.object_url" placeholder="线上对象地址，可选" />
              <button class="secondary-btn" @click="saveSupportFile">保存支持文件</button>
            </div>
          </section>

          <section class="subgrid">
            <div>
              <h3>使用记录</h3>
              <div v-if="usage.length === 0" class="empty">暂无使用记录</div>
              <div v-for="item in usage.slice(0, 8)" :key="item.id" class="mini-row">
                <span>{{ item.status || '记录' }}</span>
                <span>{{ formatTime(item.created_at) }}</span>
              </div>
            </div>
            <div>
              <h3>反馈</h3>
              <div class="inline-form">
                <input v-model.number="feedbackForm.rating" type="number" min="1" max="5" />
                <input v-model="feedbackForm.comment" placeholder="反馈内容" />
                <button class="secondary-btn" @click="submitFeedback">提交</button>
              </div>
              <div v-for="item in feedback.slice(0, 8)" :key="item.id" class="mini-row">
                <span>{{ item.rating || '-' }} 分 · {{ item.comment || '无备注' }}</span>
                <span>{{ statusLabel(item.status) }}</span>
              </div>
            </div>
          </section>

          <section>
            <h3>审计日志</h3>
            <div v-if="auditLogs.length === 0" class="empty">暂无审计日志</div>
            <div v-for="log in auditLogs.slice(0, 10)" :key="log.id" class="mini-row">
              <span>{{ actionLabel(log.action) }}</span>
              <span>{{ formatTime(log.created_at) }}</span>
            </div>
          </section>
        </template>
        <div v-else class="empty">选择一个技能查看详情和完整生命周期操作。</div>
      </div>

      <form class="panel create-panel" @submit.prevent="createSkill">
        <h2>新建企业 Skill</h2>
        <label>机器名<input v-model="form.name" placeholder="market-analysis-sop" /></label>
        <label>展示名<input v-model="form.display_name" placeholder="市场分析 SOP" /></label>
        <label>描述<input v-model="form.description" placeholder="这个技能适合什么业务场景" /></label>
        <div class="two-cols">
          <label>分类<input v-model="form.category" placeholder="跨境电商" /></label>
          <label>业务域<input v-model="form.business_domain" placeholder="竞品分析" /></label>
        </div>
        <label>SKILL.md<textarea v-model="form.content_md" rows="12" /></label>
        <label class="checkbox-row"><input v-model="form.publish" type="checkbox" />创建后直接发布</label>
        <button class="primary-btn" data-testid="enterprise-skill-create-submit" :disabled="saving">{{ saving ? '保存中...' : '保存技能' }}</button>
      </form>

      <form class="panel create-panel" @submit.prevent="createProposal">
        <h2>手动沉淀提案</h2>
        <label>标题<input v-model="proposalForm.title" placeholder="把本次流程沉淀为企业 Skill" /></label>
        <label>说明<input v-model="proposalForm.description" placeholder="提案来源和价值" /></label>
        <div class="two-cols">
          <label>建议机器名<input v-model="proposalForm.suggested_name" placeholder="product-research-sop" /></label>
          <label>建议分类<input v-model="proposalForm.suggested_category" placeholder="运营 SOP" /></label>
        </div>
        <label>来源会话<input v-model="proposalForm.source_session_id" placeholder="可选，会话 ID" /></label>
        <label>提案内容<textarea v-model="proposalForm.content_md" rows="12" /></label>
        <button class="primary-btn" data-testid="enterprise-proposal-create" :disabled="saving">创建提案</button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.enterprise-skills-page { padding: 24px; color: #1f2937; }
.page-header, .summary-row, .filters, .panel-title-row, .action-row, .skill-row, .mini-row, .inline-form { display: flex; align-items: center; }
.page-header { justify-content: space-between; gap: 16px; margin-bottom: 18px; }
h1, h2, h3, p { margin: 0; }
h1 { font-size: 24px; }
h2 { font-size: 16px; margin-bottom: 14px; }
h3 { font-size: 13px; margin: 12px 0 8px; }
.page-header p, .skill-main p, .panel-title-row p, .empty, .snapshot-line { color: #6b7280; font-size: 13px; margin-top: 6px; }
.summary-row, .filters { gap: 12px; margin-bottom: 14px; }
.summary-row > div, .panel { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
.summary-row > div { gap: 8px; padding: 12px 14px; }
.metric { font-size: 22px; font-weight: 700; }
.content-grid { display: grid; grid-template-columns: minmax(280px, .8fr) minmax(480px, 1.2fr); gap: 18px; }
.panel { padding: 16px; }
.detail-panel, .create-panel { display: grid; gap: 12px; }
.skill-row { justify-content: space-between; gap: 14px; padding: 12px; border: 1px solid #edf0f3; border-radius: 8px; cursor: pointer; margin-bottom: 10px; }
.skill-row.active { border-color: #111827; }
.skill-main { min-width: 0; }
.skill-main strong, .skill-main span { display: block; }
.skill-main span { color: #6b7280; font-size: 12px; margin-top: 2px; }
.skill-meta, .action-row { display: flex; gap: 8px; white-space: nowrap; }
.status { border-radius: 999px; padding: 2px 8px; font-size: 12px; background: #eef2ff; color: #3730a3; }
.status.published, .status.converted, .status.approved { background: #ecfdf5; color: #047857; }
.status.archived, .status.rejected { background: #f3f4f6; color: #4b5563; }
label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
input, select, textarea { width: 100%; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 10px; font: inherit; font-weight: 400; }
textarea { resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
.two-cols, .subgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.checkbox-row { display: flex; align-items: center; gap: 8px; }
.checkbox-row input { width: auto; }
.panel-title-row, .skill-row, .mini-row { justify-content: space-between; }
.mini-row { gap: 10px; padding: 8px 0; border-bottom: 1px solid #f3f4f6; font-size: 12px; }
.inline-form { gap: 8px; margin-top: 8px; }
.file-editor { display: grid; grid-template-columns: 1fr 140px 150px; gap: 8px; margin-top: 8px; }
.file-editor textarea, .file-editor input:nth-of-type(2), .file-editor button { grid-column: 1 / -1; }
.primary-btn, .secondary-btn, .danger-btn, .link-btn { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 12px; background: #fff; cursor: pointer; }
.primary-btn { border-color: #111827; background: #111827; color: white; }
.danger-btn { border-color: #dc2626; color: #dc2626; }
.link-btn { border: 0; padding: 2px 4px; color: #2563eb; background: transparent; }
button:disabled { opacity: .6; cursor: not-allowed; }
.error { padding: 10px 12px; border-radius: 6px; background: #fef2f2; color: #b91c1c; margin-bottom: 14px; }
@media (max-width: 1100px) { .content-grid, .two-cols, .subgrid, .file-editor { grid-template-columns: 1fr; } }
</style>
