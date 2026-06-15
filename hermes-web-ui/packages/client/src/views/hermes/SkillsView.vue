<script setup lang="ts">
import { computed, ref } from 'vue'

interface BusinessSkill {
  id: string
  name: string
  tool: string
  category: string
  status: 'online' | 'long-running'
  description: string
  trigger: string[]
  required: string[]
  optional: string[]
  output: string[]
}

const query = ref('')
const selectedId = ref('smart-image')

const skills: BusinessSkill[] = [
  {
    id: 'smart-image',
    name: '图片智创',
    tool: 'deepseen_smart_image_create_and_wait',
    category: '素材生成',
    status: 'long-running',
    description: '根据商品关键词和商品素材生成跨境电商主图、场景图、营销图。',
    trigger: ['产品主图', 'Listing 图片', 'TikTok Shop 场景图', '商品关键词出图'],
    required: ['商品关键词或简短商品标题'],
    optional: ['商品图片或 OSS 图片地址', '卖点、材质、风格、使用场景', '目标市场'],
    output: ['生成图片', '图片地址', '任务编号', '生成状态'],
  },
  {
    id: 'smart-video',
    name: '视频智创',
    tool: 'deepseen_smart_video_create_and_wait',
    category: '素材生成',
    status: 'long-running',
    description: '根据商品标题、卖点和素材生成 TikTok/跨境营销短视频。',
    trigger: ['商品短视频', 'TikTok 广告视频', '带货素材视频'],
    required: ['商品标题或核心卖点'],
    optional: ['商品图片或 OSS 图片地址', '生成数量', '视频模型', '目标市场'],
    output: ['生成视频', '视频地址', '任务编号', '生成状态'],
  },
  {
    id: 'image-recreation',
    name: '图片二创',
    tool: 'deepseen_image_recreation_create_and_wait',
    category: '竞品复刻',
    status: 'long-running',
    description: '参考 TikTok Shop 竞品商品链接，并结合自有商品图生成可投放的二创图片。',
    trigger: ['竞品图片复刻', 'TikTok Shop 商品图二创', '参考爆款图生成新图'],
    required: ['TikTok Shop 竞品商品链接'],
    optional: ['自有商品图片或 OSS 图片地址', '画幅比例', '生成模型'],
    output: ['二创图片', '图片地址', '任务编号', '失败原因或校验提示'],
  },
  {
    id: 'video-recreation',
    name: '视频二创',
    tool: 'deepseen_video_recreation_create_and_wait',
    category: '竞品复刻',
    status: 'long-running',
    description: '参考竞品视频或本地参考视频，并结合商品图生成二创短视频。',
    trigger: ['爆款视频复刻', '竞品视频二创', '参考视频生成带货短片'],
    required: ['竞品视频链接或参考视频文件'],
    optional: ['商品图片或 OSS 图片地址', '视频组数', '视频模型'],
    output: ['二创视频', '视频地址', '任务编号', '生成进度'],
  },
  {
    id: 'product-report',
    name: '产品报告',
    tool: 'deepseen_product_report_create_and_wait',
    category: '选品决策',
    status: 'long-running',
    description: '输出产品可行性、市场、定价、备货、供应链和专利风险分析。',
    trigger: ['产品能不能做', '选品报告', '定价和备货建议', '专利风险'],
    required: ['产品名称', '目标市场'],
    optional: ['目标客群', '平台', '卖点', '采购价', '预期售价', '重量尺寸', '计划备货量', '供应商数量'],
    output: ['市场判断', '五维评分', '利润测算', '用户反馈', '专利风险', '视频可行性'],
  },
  {
    id: 'competitor-single',
    name: '单竞品分析',
    tool: 'deepseen_competitor_analyze_and_wait',
    category: '竞品研究',
    status: 'online',
    description: '对单个 TikTok Shop 竞品链接做商品表现、素材、卖点和风险分析。',
    trigger: ['分析这个竞品', '单个商品链接分析', '竞品卖点拆解'],
    required: ['竞品商品链接'],
    optional: ['目标市场'],
    output: ['商品概览', '销量/价格线索', '素材来源', '卖点拆解', '优化建议'],
  },
  {
    id: 'competitor-multi',
    name: '多竞品分析',
    tool: 'deepseen_competitor_analyze_multi_and_wait',
    category: '竞品研究',
    status: 'long-running',
    description: '根据关键词或品类批量研究多个竞品，形成市场和代表产品对比。',
    trigger: ['多竞品分析', '关键词竞品调研', '品类市场分析'],
    required: ['产品关键词或品类关键词'],
    optional: ['目标市场'],
    output: ['市场概览', '代表产品', '价格带', '内容趋势', '机会和风险'],
  },
  {
    id: 'creator-analysis',
    name: '达人分析',
    tool: 'deepseen_creator_analyze_and_wait',
    category: '达人营销',
    status: 'long-running',
    description: '根据产品和市场定位，分析适合合作的达人画像、达人类型和投放策略。',
    trigger: ['找什么达人', '达人画像', '达人投放策略', '达人适配分析'],
    required: ['产品名称', '目标市场'],
    optional: ['目标售价或价格带', '类目', '竞品名称', '目标用户年龄', '目标用户性别', '分析深度'],
    output: ['达人画像', '五力共性', '风险补充', '样本达人', '评分标准', '直播观察'],
  },
  {
    id: 'creator-score',
    name: '达人评分',
    tool: 'deepseen_creator_score_and_wait',
    category: '达人营销',
    status: 'long-running',
    description: '对达人表格或达人名单进行评分、排序和合作优先级判断。',
    trigger: ['达人名单评分', '达人排序', '达人合作优先级'],
    required: ['产品名称', '目标市场', '达人表格或达人名单数据'],
    optional: ['目标用户', '类目', '价格带', '评分口径'],
    output: ['达人评分', '排序结果', '适配原因', '风险提示'],
  },
  {
    id: 'video-analysis',
    name: '视频分析',
    tool: 'deepseen_video_analysis_create_and_wait',
    category: '内容分析',
    status: 'long-running',
    description: '拆解视频脚本、结构、卖点表达和爆点，用于复盘或二创前分析。',
    trigger: ['分析这个视频', '爆款视频拆解', '视频脚本分析'],
    required: ['视频链接或可访问的视频文件'],
    optional: ['产品背景', '目标市场', '关注点'],
    output: ['视频结构', '脚本拆解', '卖点表达', '可复用元素', '风险提示'],
  },
]

const categories = computed(() => Array.from(new Set(skills.map(skill => skill.category))))
const selected = computed(() => skills.find(skill => skill.id === selectedId.value) || skills[0])
const filteredSkills = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return skills
  return skills.filter(skill => [
    skill.name,
    skill.tool,
    skill.category,
    skill.description,
    ...skill.trigger,
  ].some(value => value.toLowerCase().includes(q)))
})

function selectFirstInCategory(category: string) {
  const skill = filteredSkills.value.find(item => item.category === category)
  if (skill) selectedId.value = skill.id
}
</script>

<template>
  <div class="skills-view">
    <header class="skills-header">
      <div>
        <h2>Herbound 跨境技能中心</h2>
        <p>这些是当前智能体优先识别和调用的业务能力，底层统一接入 DeepSeen SDK 工具集。</p>
      </div>
      <input v-model="query" class="skill-search" placeholder="搜索能力、工具或业务场景" />
    </header>

    <main class="skills-shell">
      <aside class="skill-nav">
        <button
          v-for="category in categories"
          :key="category"
          class="category-row"
          type="button"
          @click="selectFirstInCategory(category)"
        >
          <span>{{ category }}</span>
          <strong>{{ filteredSkills.filter(skill => skill.category === category).length }}</strong>
        </button>

        <div class="skill-list">
          <button
            v-for="skill in filteredSkills"
            :key="skill.id"
            type="button"
            class="skill-row"
            :class="{ active: selected.id === skill.id }"
            @click="selectedId = skill.id"
          >
            <span class="skill-row-name">{{ skill.name }}</span>
            <span class="skill-row-tool">{{ skill.tool }}</span>
          </button>
        </div>
      </aside>

      <section class="skill-detail">
        <div class="detail-head">
          <div>
            <span class="detail-category">{{ selected.category }}</span>
            <h3>{{ selected.name }}</h3>
            <p>{{ selected.description }}</p>
          </div>
          <span class="status-pill" :class="selected.status">
            {{ selected.status === 'long-running' ? '长任务/有进度' : '在线调用' }}
          </span>
        </div>

        <div class="tool-strip">
          <span>调用工具</span>
          <code>{{ selected.tool }}</code>
        </div>

        <div class="detail-grid">
          <section>
            <h4>用户会这样说</h4>
            <ul>
              <li v-for="item in selected.trigger" :key="item">{{ item }}</li>
            </ul>
          </section>
          <section>
            <h4>必须补齐的信息</h4>
            <ul>
              <li v-for="item in selected.required" :key="item">{{ item }}</li>
            </ul>
          </section>
          <section>
            <h4>可选增强信息</h4>
            <ul>
              <li v-for="item in selected.optional" :key="item">{{ item }}</li>
            </ul>
          </section>
          <section>
            <h4>回显给用户的核心结果</h4>
            <ul>
              <li v-for="item in selected.output" :key="item">{{ item }}</li>
            </ul>
          </section>
        </div>

        <div class="policy-band">
          <div>
            <h4>Herbound 执行规则</h4>
            <p>先判断业务意图，再选择对应 DeepSeen 工具。工具调用完成后只做字段翻译、富媒体展示和结构化排版，不增加二次业务结论。</p>
          </div>
          <div>
            <h4>资源上传规则</h4>
            <p>生产环境优先使用 OSS/CDN 地址。用户上传本地图片或视频时，先由后端上传为 DeepSeen 可访问资源，再把 URL 或 file_id 交给 SDK。</p>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.skills-view {
  height: calc(100 * var(--vh));
  display: flex;
  flex-direction: column;
  background: $bg-primary;
  color: $text-primary;
}

.skills-header {
  min-height: 84px;
  padding: 18px 22px;
  border-bottom: 1px solid $border-color;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;

  h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
  }

  p {
    margin: 6px 0 0;
    color: $text-secondary;
    font-size: 13px;
  }
}

.skill-search {
  width: min(320px, 36vw);
  height: 34px;
  border: 1px solid $border-color;
  border-radius: 6px;
  background: $bg-secondary;
  color: $text-primary;
  padding: 0 11px;
  outline: none;

  &:focus {
    border-color: rgba(var(--accent-primary-rgb), 0.7);
  }
}

.skills-shell {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
}

.skill-nav {
  border-right: 1px solid $border-color;
  overflow-y: auto;
  padding: 14px;
  background: $bg-secondary;
}

.category-row,
.skill-row {
  width: 100%;
  border: 0;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.category-row {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px;
  margin-bottom: 4px;
  background: transparent;
  border-radius: 6px;
  color: $text-secondary;
  font-size: 12px;

  &:hover {
    background: rgba(var(--accent-primary-rgb), 0.06);
  }

  strong {
    font-size: 11px;
    font-weight: 600;
  }
}

.skill-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.skill-row {
  min-height: 58px;
  padding: 9px 10px;
  background: $bg-card;
  border: 1px solid $border-color;
  border-radius: 8px;

  &:hover {
    border-color: rgba(var(--accent-primary-rgb), 0.35);
  }

  &.active {
    border-color: rgba(var(--accent-primary-rgb), 0.7);
    background: rgba(var(--accent-primary-rgb), 0.08);
  }
}

.skill-row-name {
  display: block;
  font-size: 14px;
  font-weight: 650;
}

.skill-row-tool {
  display: block;
  margin-top: 5px;
  color: $text-muted;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-detail {
  min-width: 0;
  overflow-y: auto;
  padding: 24px;
}

.detail-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  align-items: flex-start;

  h3 {
    margin: 6px 0;
    font-size: 28px;
    line-height: 1.2;
  }

  p {
    margin: 0;
    max-width: 760px;
    color: $text-secondary;
    line-height: 1.7;
  }
}

.detail-category {
  color: $text-muted;
  font-size: 12px;
  font-weight: 700;
}

.status-pill {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 6px 10px;
  font-size: 12px;
  border: 1px solid $border-color;

  &.long-running {
    color: $warning;
    background: rgba(245, 158, 11, 0.08);
  }

  &.online {
    color: $success;
    background: rgba(34, 197, 94, 0.08);
  }
}

.tool-strip {
  margin-top: 22px;
  padding: 12px 14px;
  border: 1px solid $border-color;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  background: $bg-secondary;

  span {
    color: $text-muted;
    font-size: 12px;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
  }
}

.detail-grid {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;

  section {
    border: 1px solid $border-color;
    border-radius: 8px;
    padding: 15px 16px;
    background: $bg-card;
  }

  h4 {
    margin: 0 0 10px;
    font-size: 14px;
  }

  ul {
    margin: 0;
    padding-left: 18px;
    color: $text-secondary;
    line-height: 1.8;
  }
}

.policy-band {
  margin-top: 18px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;

  div {
    border-left: 3px solid rgba(var(--accent-primary-rgb), 0.7);
    padding: 12px 14px;
    background: $bg-secondary;
    border-radius: 6px;
  }

  h4 {
    margin: 0 0 6px;
    font-size: 14px;
  }

  p {
    margin: 0;
    color: $text-secondary;
    line-height: 1.7;
    font-size: 13px;
  }
}

@media (max-width: $breakpoint-mobile) {
  .skills-header {
    align-items: stretch;
    flex-direction: column;
  }

  .skill-search {
    width: 100%;
  }

  .skills-shell {
    grid-template-columns: 1fr;
  }

  .skill-nav {
    border-right: 0;
    border-bottom: 1px solid $border-color;
    max-height: 280px;
  }

  .detail-grid,
  .policy-band {
    grid-template-columns: 1fr;
  }

  .detail-head {
    flex-direction: column;
  }
}
</style>
