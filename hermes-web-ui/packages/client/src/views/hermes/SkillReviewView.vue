<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  approveEnterpriseSkill,
  approveEnterpriseSkillProposal,
  convertEnterpriseSkillProposal,
  fetchEnterpriseSkillProposals,
  fetchEnterpriseSkills,
  rejectEnterpriseSkill,
  rejectEnterpriseSkillProposal,
  scanEnterpriseSkillGovernance,
  submitEnterpriseSkillReview,
  type EnterpriseSkill,
  type EnterpriseSkillProposal,
  type GovernanceFinding,
} from '@/api/hermes/enterpriseSkills'

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const reviewComment = ref('')
const draftSkills = ref<EnterpriseSkill[]>([])
const proposals = ref<EnterpriseSkillProposal[]>([])
const governanceByProposal = reactive<Record<string, GovernanceFinding[]>>({})
const convertForm = reactive<Record<string, { name: string; display_name: string; publish: boolean }>>({})

const pendingSkills = computed(() => draftSkills.value.filter(item => item.status === 'review'))
const pendingProposals = computed(() => proposals.value.filter(item => item.status === 'pending'))
const proposalHistory = computed(() => proposals.value.filter(item => item.status !== 'pending'))

function formatTime(value?: number | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    draft: '草稿',
    review: '审核中',
    pending: '待审核',
    approved: '已通过',
    rejected: '已拒绝',
    converted: '已转为 Skill',
  }
  return map[status] || status
}

function riskLabel(findings: GovernanceFinding[]) {
  if (!findings.length) return '后端扫描未发现高风险项'
  const high = findings.filter(item => item.severity === 'high').length
  return high ? `发现 ${high} 个高风险项` : `发现 ${findings.length} 个提示项`
}

async function loadGovernance(proposal: EnterpriseSkillProposal) {
  try {
    governanceByProposal[proposal.id] = await scanEnterpriseSkillGovernance(proposal.content_md || '')
  } catch {
    governanceByProposal[proposal.id] = []
  }
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [skillRes, proposalRes] = await Promise.all([
      fetchEnterpriseSkills({ status: 'review', page_size: 100 }),
      fetchEnterpriseSkillProposals(),
    ])
    draftSkills.value = skillRes.skills
    proposals.value = proposalRes
    await Promise.all(proposalRes.map(loadGovernance))
    for (const proposal of proposalRes) {
      if (!convertForm[proposal.id]) {
        convertForm[proposal.id] = {
          name: proposal.suggested_name || '',
          display_name: proposal.title,
          publish: false,
        }
      }
    }
  } catch (err: any) {
    error.value = err?.message || '加载审核中心失败'
  } finally {
    loading.value = false
  }
}

async function runAction(action: () => Promise<unknown>, fallback: string) {
  saving.value = true
  error.value = ''
  try {
    await action()
    reviewComment.value = ''
    await load()
  } catch (err: any) {
    error.value = err?.message || fallback
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <main class="review-page" data-testid="enterprise-review-page">
    <header class="page-header">
      <div>
        <h1>技能审核</h1>
        <p>集中处理企业 Skill 草稿审核和智能体沉淀提案。</p>
      </div>
      <button class="secondary-btn" :disabled="loading" @click="load">刷新</button>
    </header>

    <section class="summary-row">
      <div><span class="metric">{{ pendingSkills.length }}</span><span>待审 Skill</span></div>
      <div><span class="metric">{{ pendingProposals.length }}</span><span>待审提案</span></div>
      <div><span class="metric">{{ proposalHistory.length }}</span><span>历史提案</span></div>
    </section>
    <p v-if="error" class="error">{{ error }}</p>

    <label class="comment-box">
      审核意见
      <input data-testid="enterprise-review-comment-input" v-model="reviewComment" placeholder="可选，记录通过或拒绝原因" />
    </label>

    <section class="review-grid">
      <div class="panel">
        <h2>Skill 草稿审核</h2>
        <div v-if="pendingSkills.length === 0" class="empty">暂无待审核 Skill</div>
        <article v-for="skill in pendingSkills" :key="skill.id" class="review-card">
          <div class="card-head">
            <div>
              <strong>{{ skill.display_name || skill.name }}</strong>
              <p>{{ skill.name }} · {{ skill.description || '暂无描述' }}</p>
            </div>
            <span class="status">{{ statusLabel(skill.status) }}</span>
          </div>
          <pre>{{ skill.latest_version?.content_md || '' }}</pre>
          <div class="action-row">
            <button class="secondary-btn" :disabled="saving" @click="runAction(() => submitEnterpriseSkillReview(skill.id), '重新提交失败')">重新提交</button>
            <button data-testid="enterprise-review-skill-approve" class="primary-btn" :disabled="saving" @click="runAction(() => approveEnterpriseSkill(skill.id), '审核通过失败')">通过</button>
            <button data-testid="enterprise-review-skill-reject" class="danger-btn" :disabled="saving" @click="runAction(() => rejectEnterpriseSkill(skill.id, reviewComment), '拒绝失败')">拒绝</button>
          </div>
        </article>
      </div>

      <div class="panel">
        <h2>沉淀提案审核</h2>
        <div v-if="pendingProposals.length === 0" class="empty">暂无待审提案</div>
        <article v-for="proposal in pendingProposals" :key="proposal.id" class="review-card">
          <div class="card-head">
            <div>
              <strong>{{ proposal.title }}</strong>
              <p>来源：{{ proposal.source_type }} · 会话：{{ proposal.source_session_id || '-' }} · {{ formatTime(proposal.created_at) }}</p>
            </div>
            <span class="status" :class="proposal.status">{{ statusLabel(proposal.status) }}</span>
          </div>
          <div class="governance" :class="{ risky: governanceByProposal[proposal.id]?.length }">
            <strong>{{ riskLabel(governanceByProposal[proposal.id] || []) }}</strong>
            <ul v-if="governanceByProposal[proposal.id]?.length">
              <li v-for="finding in governanceByProposal[proposal.id]" :key="`${finding.rule_id}-${finding.message}`">
                {{ finding.severity }} · {{ finding.rule_id }} · {{ finding.message }} · {{ finding.suggestion }}
              </li>
            </ul>
          </div>
          <p>{{ proposal.description || proposal.source_summary || '暂无说明' }}</p>
          <pre>{{ proposal.content_md }}</pre>

          <div class="convert-row">
            <input v-model="convertForm[proposal.id].name" placeholder="转换后的机器名" />
            <input v-model="convertForm[proposal.id].display_name" placeholder="转换后的展示名" />
            <label><input v-model="convertForm[proposal.id].publish" type="checkbox" />转换后发布</label>
          </div>

          <div class="action-row">
            <button data-testid="enterprise-review-proposal-approve" class="secondary-btn" :disabled="saving" @click="runAction(() => approveEnterpriseSkillProposal(proposal.id, reviewComment), '提案通过失败')">通过</button>
            <button data-testid="enterprise-review-proposal-reject" class="danger-btn" :disabled="saving" @click="runAction(() => rejectEnterpriseSkillProposal(proposal.id, reviewComment), '提案拒绝失败')">拒绝</button>
            <button
              data-testid="enterprise-review-proposal-convert"
              class="primary-btn"
              :disabled="saving"
              @click="runAction(() => convertEnterpriseSkillProposal(proposal.id, convertForm[proposal.id]), '转为 Skill 失败')"
            >
              转为 Skill
            </button>
          </div>
        </article>
      </div>
    </section>

    <section class="panel history-panel">
      <h2>提案历史</h2>
      <div v-if="proposalHistory.length === 0" class="empty">暂无历史提案</div>
      <article v-for="proposal in proposalHistory" :key="proposal.id" class="history-row">
        <div>
          <strong>{{ proposal.title }}</strong>
          <p>{{ proposal.review_comment || proposal.description || proposal.source_summary || '暂无说明' }}</p>
        </div>
        <span class="status" :class="proposal.status">{{ statusLabel(proposal.status) }}</span>
      </article>
    </section>
  </main>
</template>

<style scoped>
.review-page { padding: 24px; color: #1f2937; }
.page-header, .summary-row, .card-head, .action-row, .convert-row, .history-row { display: flex; align-items: center; }
.page-header { justify-content: space-between; gap: 16px; margin-bottom: 18px; }
h1, h2, p { margin: 0; }
h1 { font-size: 24px; }
h2 { font-size: 16px; margin-bottom: 14px; }
.page-header p, .card-head p, .history-row p, .empty { color: #6b7280; font-size: 13px; margin-top: 6px; }
.summary-row { gap: 12px; margin-bottom: 14px; }
.summary-row > div, .panel { border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
.summary-row > div { gap: 8px; padding: 12px 14px; }
.metric { font-size: 22px; font-weight: 700; }
.comment-box { display: grid; gap: 6px; margin-bottom: 14px; max-width: 680px; font-size: 13px; }
.review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.panel { padding: 16px; }
.history-panel { margin-top: 18px; }
.review-card { border-top: 1px solid #f3f4f6; padding: 14px 0; display: grid; gap: 10px; }
.history-row { justify-content: space-between; gap: 12px; border-top: 1px solid #f3f4f6; padding: 12px 0; }
.card-head { justify-content: space-between; gap: 12px; }
.status { border-radius: 999px; padding: 2px 8px; font-size: 12px; background: #eef2ff; color: #3730a3; white-space: nowrap; }
.status.converted, .status.approved { background: #ecfdf5; color: #047857; }
.status.rejected { background: #f3f4f6; color: #4b5563; }
pre { max-height: 220px; overflow: auto; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px; font-size: 12px; white-space: pre-wrap; background: #fafafa; }
.action-row, .convert-row { gap: 8px; }
.convert-row { display: grid; grid-template-columns: 1fr 1fr auto; }
input { width: 100%; border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 10px; font: inherit; }
label { font-size: 13px; }
.governance { border: 1px solid #d1fae5; background: #ecfdf5; color: #047857; border-radius: 6px; padding: 10px; font-size: 13px; }
.governance.risky { border-color: #fed7aa; background: #fff7ed; color: #9a3412; }
.governance ul { margin: 6px 0 0 18px; padding: 0; }
.primary-btn, .secondary-btn, .danger-btn { border: 1px solid #d1d5db; border-radius: 6px; padding: 8px 12px; background: #fff; cursor: pointer; }
.primary-btn { border-color: #111827; background: #111827; color: white; }
.danger-btn { border-color: #dc2626; color: #dc2626; }
button:disabled { opacity: .6; cursor: not-allowed; }
.error { padding: 10px 12px; border-radius: 6px; background: #fef2f2; color: #b91c1c; margin-bottom: 14px; }
@media (max-width: 1100px) { .review-grid, .convert-row { grid-template-columns: 1fr; } }
</style>
