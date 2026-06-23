import type * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Switch } from '@/components/ui/switch'
import { TextTab, TextTabMeta } from '@/components/ui/text-tab'
import { getSkills, getToolsets, toggleSkill, toggleToolset } from '@/hermes'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { notify, notifyError } from '@/store/notifications'
import type { SkillInfo, ToolsetInfo } from '@/types/hermes'

import { useRefreshHotkey } from '../hooks/use-refresh-hotkey'
import { useRouteEnumParam } from '../hooks/use-route-enum-param'
import { PAGE_INSET_X } from '../layout-constants'
import { PageSearchShell } from '../page-search-shell'
import { asText, includesQuery, toolNames, toolsetDisplayLabel } from '../settings/helpers'
import { ToolsetConfigPanel } from '../settings/toolset-config-panel'
import type { SetStatusbarItemGroup } from '../shell/statusbar-controls'

const SKILLS_MODES = ['skills', 'toolsets'] as const
type SkillsMode = (typeof SKILLS_MODES)[number]

const CATEGORY_LABELS: Record<string, string> = {
  'agent-generated': '智能体沉淀',
  apple: 'Apple 生态',
  'autonomous-ai-agents': '智能体开发',
  creative: '创意创作',
  crossborder: '跨境业务',
  'crossborder-deepseen': 'DeepSeen 跨境业务',
  'data-science': '数据分析',
  data: '数据分析',
  default: '默认',
  development: '开发',
  email: '邮件',
  general: '通用',
  github: '代码协作',
  media: '媒体创作',
  mlops: '模型工程',
  'note-taking': '知识笔记',
  productivity: '效率工具',
  research: '调研',
  'smart-home': '智能家居',
  'software-development': '软件开发',
  system: '系统'
}

const SKILL_LABELS: Record<string, string> = {
  'apikey-image-gen': '图片生成',
  'apple-notes': 'Apple 备忘录',
  'apple-reminders': 'Apple 提醒事项',
  'architecture-diagram': '架构图绘制',
  'ascii-art': '字符画',
  'ascii-video': '字符视频',
  'baoyu-infographic': '信息图生成',
  'claude-code': 'Claude Code 协作',
  'claude-design': 'Claude 设计',
  codex: 'Codex 协作',
  comfyui: 'ComfyUI 工作流',
  'crossborder-deepseen': 'DeepSeen 跨境分析',
  'design-md': 'Markdown 设计稿',
  excalidraw: 'Excalidraw 绘图',
  findmy: '查找设备',
  'hermes-agent': 'Herbound 智能体开发',
  humanizer: '内容拟人化',
  imessage: 'iMessage 消息',
  'macos-computer-use': 'macOS 电脑操作',
  'manim-video': 'Manim 视频',
  opencode: 'OpenCode 协作',
  p5js: 'P5.js 创作',
  'popular-web-designs': '热门网页设计',
  pretext: 'PreTeXt 文档',
  sketch: '草图绘制',
  'songwriting-and-ai-music': '歌曲与 AI 音乐',
  'touchdesigner-mcp': 'TouchDesigner MCP'
}

const SKILL_DESCRIPTION_LABELS: Record<string, string> = {
  'apikey-image-gen': '调用已配置的图片生成工具，并把生成结果回显到对话中。',
  'crossborder-deepseen': '调用 DeepSeen 跨境工具完成商品、达人、竞品等业务分析，并按用户友好的形式展示结果。',
  codex: '协助使用 Codex 进行代码阅读、修改、测试和交付。',
  'hermes-agent': '处理 Herbound 智能体自身的配置、运行、调试和开发任务。'
}

const TOOLSET_LABELS: Record<string, string> = {
  browser: '浏览器',
  coding: '代码开发',
  cronjob: '定时任务',
  deepseen: 'DeepSeen 工具',
  file: '文件',
  image_gen: '图片生成',
  kanban: '看板协作',
  memory: '记忆',
  mcp: 'MCP',
  terminal: '终端',
  tts: '语音合成',
  video_gen: '视频生成',
  web: '网页搜索',
  x_search: 'X 搜索'
}

const TOOLSET_DESCRIPTION_LABELS: Record<string, string> = {
  browser: '允许智能体操作浏览器页面并读取页面状态。',
  cronjob: '允许创建和管理定时运行的任务。',
  file: '允许智能体读取和处理文件内容。',
  image_gen: '允许通过外部图片生成服务创建图片。',
  memory: '允许智能体读取和写入长期记忆。',
  terminal: '允许智能体运行终端命令。',
  tts: '允许将文本转换为语音。',
  video_gen: '允许通过外部视频生成服务创建视频。',
  web: '允许智能体搜索网页并提取网页内容。'
}

function categoryFor(skill: SkillInfo): string {
  return asText(skill.category) || 'general'
}

function displayCategory(category: string): string {
  return CATEGORY_LABELS[category.toLowerCase()] || `自定义分类：${category}`
}

function displaySkillName(skill: SkillInfo): string {
  const name = asText(skill.name)

  return SKILL_LABELS[name] || `自定义技能：${name}`
}

function displaySkillDescription(skill: SkillInfo): string {
  const name = asText(skill.name)

  return SKILL_DESCRIPTION_LABELS[name] || '启用后，智能体会按该技能的说明处理相关任务。'
}

function displayToolsetName(toolset: ToolsetInfo): string {
  const name = asText(toolset.name)
  const label = toolsetDisplayLabel(toolset)

  return TOOLSET_LABELS[name] || TOOLSET_LABELS[label.toLowerCase()] || `自定义工具集：${label}`
}

function displayToolsetDescription(toolset: ToolsetInfo): string {
  const name = asText(toolset.name)

  return TOOLSET_DESCRIPTION_LABELS[name] || '启用后，智能体可以在对话中调用该工具集下的工具。'
}

function filteredSkills(skills: SkillInfo[], query: string, category: string | null): SkillInfo[] {
  const q = query.trim().toLowerCase()

  return skills
    .filter(skill => {
      if (category && categoryFor(skill) !== category) {
        return false
      }

      if (!q) {
        return true
      }

      return (
        includesQuery(skill.name, q) ||
        includesQuery(skill.description, q) ||
        includesQuery(skill.category, q) ||
        includesQuery(displaySkillName(skill), q) ||
        includesQuery(displaySkillDescription(skill), q)
      )
    })
    .sort((a, b) => displaySkillName(a).localeCompare(displaySkillName(b), 'zh-CN'))
}

function filteredToolsets(toolsets: ToolsetInfo[], query: string): ToolsetInfo[] {
  const q = query.trim().toLowerCase()

  return toolsets
    .filter(toolset => {
      if (!q) {
        return true
      }

      const label = toolsetDisplayLabel(toolset)

      return (
        includesQuery(toolset.name, q) ||
        includesQuery(label, q) ||
        includesQuery(displayToolsetName(toolset), q) ||
        includesQuery(toolset.label, q) ||
        includesQuery(toolset.description, q) ||
        toolNames(toolset).some(name => includesQuery(name, q))
      )
    })
    .sort((a, b) => displayToolsetName(a).localeCompare(displayToolsetName(b), 'zh-CN'))
}

interface SkillsViewProps extends React.ComponentProps<'section'> {
  setStatusbarItemGroup?: SetStatusbarItemGroup
}

export function SkillsView({ setStatusbarItemGroup: _setStatusbarItemGroup, ...props }: SkillsViewProps) {
  const { t } = useI18n()
  const [mode, setMode] = useRouteEnumParam('tab', SKILLS_MODES, 'skills')
  const [query, setQuery] = useState('')
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [toolsets, setToolsets] = useState<ToolsetInfo[] | null>(null)
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [savingSkill, setSavingSkill] = useState<string | null>(null)
  const [savingToolset, setSavingToolset] = useState<string | null>(null)
  const [expandedToolset, setExpandedToolset] = useState<string | null>(null)

  const refreshCapabilities = useCallback(async () => {
    setRefreshing(true)

    try {
      const [nextSkills, nextToolsets] = await Promise.all([getSkills(), getToolsets()])
      setSkills(nextSkills)
      setToolsets(nextToolsets)
    } catch (err) {
      notifyError(err, t.skills.skillsLoadFailed)
    } finally {
      setRefreshing(false)
    }
  }, [t])

  const refreshToolsets = useCallback(() => {
    getToolsets()
      .then(setToolsets)
      .catch(err => notifyError(err, t.skills.toolsetsRefreshFailed))
  }, [t])

  useRefreshHotkey(refreshCapabilities)

  useEffect(() => {
    void refreshCapabilities()
  }, [refreshCapabilities])

  const categories = useMemo(() => {
    if (!skills) {
      return []
    }

    const counts = new Map<string, number>()

    for (const skill of skills) {
      const key = categoryFor(skill)
      counts.set(key, (counts.get(key) || 0) + 1)
    }

    return Array.from(counts.entries())
      .sort(([a], [b]) => displayCategory(a).localeCompare(displayCategory(b), 'zh-CN'))
      .map(([key, count]) => ({ key, count }))
  }, [skills])

  const visibleSkills = useMemo(
    () => (skills ? filteredSkills(skills, query, mode === 'skills' ? activeCategory : null) : []),
    [activeCategory, mode, query, skills]
  )

  const visibleToolsets = useMemo(() => (toolsets ? filteredToolsets(toolsets, query) : []), [query, toolsets])

  const skillGroups = useMemo(() => {
    const groups = new Map<string, SkillInfo[]>()

    for (const skill of visibleSkills) {
      const key = categoryFor(skill)
      groups.set(key, [...(groups.get(key) || []), skill])
    }

    return Array.from(groups.entries()).sort(([a], [b]) =>
      displayCategory(a).localeCompare(displayCategory(b), 'zh-CN')
    )
  }, [visibleSkills])

  const totalSkills = skills?.length || 0
  const enabledToolsets = toolsets?.filter(toolset => toolset.enabled).length || 0

  async function handleToggleSkill(skill: SkillInfo, enabled: boolean) {
    setSavingSkill(skill.name)

    try {
      await toggleSkill(skill.name, enabled)
      setSkills(current => current?.map(row => (row.name === skill.name ? { ...row, enabled } : row)) ?? current)
      notify({
        kind: 'success',
        title: enabled ? t.skills.skillEnabled : t.skills.skillDisabled,
        message: t.skills.appliesToNewSessions(displaySkillName(skill))
      })
    } catch (err) {
      notifyError(err, t.skills.failedToUpdate(displaySkillName(skill)))
    } finally {
      setSavingSkill(null)
    }
  }

  async function handleToggleToolset(toolset: ToolsetInfo, enabled: boolean) {
    setSavingToolset(toolset.name)

    try {
      await toggleToolset(toolset.name, enabled)
      setToolsets(
        current =>
          current?.map(row => (row.name === toolset.name ? { ...row, enabled, available: enabled } : row)) ?? current
      )
      notify({
        kind: 'success',
        title: enabled ? t.skills.toolsetEnabled : t.skills.toolsetDisabled,
        message: t.skills.appliesToNewSessions(displayToolsetName(toolset))
      })
    } catch (err) {
      notifyError(err, t.skills.failedToUpdate(displayToolsetName(toolset)))
    } finally {
      setSavingToolset(null)
    }
  }

  return (
    <PageSearchShell
      {...props}
      filters={
        mode === 'skills' && categories.length > 0 ? (
          <>
            <TextTab active={activeCategory === null} onClick={() => setActiveCategory(null)}>
              {t.skills.all} <TextTabMeta>{totalSkills}</TextTabMeta>
            </TextTab>
            {categories.map(category => (
              <TextTab
                active={activeCategory === category.key}
                key={category.key}
                onClick={() => setActiveCategory(activeCategory === category.key ? null : category.key)}
              >
                {displayCategory(category.key)} <TextTabMeta>{category.count}</TextTabMeta>
              </TextTab>
            ))}
          </>
        ) : undefined
      }
      onSearchChange={setQuery}
      searchHidden={mode === 'skills' ? (skills?.length ?? 0) === 0 : (toolsets?.length ?? 0) === 0}
      searchPlaceholder={mode === 'skills' ? t.skills.searchSkills : t.skills.searchToolsets}
      searchTrailingAction={
        <Button
          aria-label={refreshing ? t.skills.refreshing : t.skills.refresh}
          className="text-(--ui-text-tertiary) hover:bg-transparent hover:text-foreground"
          disabled={refreshing}
          onClick={() => void refreshCapabilities()}
          size="icon-xs"
          title={refreshing ? t.skills.refreshing : t.skills.refresh}
          type="button"
          variant="ghost"
        >
          <Codicon name="refresh" size="0.875rem" spinning={refreshing} />
        </Button>
      }
      searchValue={query}
      tabs={
        <>
          <TextTab active={mode === 'skills'} onClick={() => setMode('skills')}>
            {t.skills.tabSkills}
          </TextTab>
          <TextTab active={mode === 'toolsets'} onClick={() => setMode('toolsets')}>
            {t.skills.tabToolsets}
          </TextTab>
        </>
      }
    >
      {!skills || !toolsets ? (
        <PageLoader label={t.skills.loading} />
      ) : mode === 'skills' ? (
        <div className={cn('h-full overflow-y-auto py-3', PAGE_INSET_X)}>
          {visibleSkills.length === 0 ? (
            <EmptyState description={t.skills.noSkillsDesc} title={t.skills.noSkillsTitle} />
          ) : (
            <div className="space-y-4">
              {skillGroups.map(([category, list]) => (
                <div className="space-y-1.5" key={category}>
                  {activeCategory === null && (
                    <div className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {displayCategory(category)}
                    </div>
                  )}
                  <div>
                    {list.map(skill => (
                      <div
                        className="grid gap-3 px-0 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                        key={skill.name}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{displaySkillName(skill)}</div>
                          <div className="mt-0.5 truncate font-mono text-[0.65rem] text-(--ui-text-tertiary)">
                            {skill.name}
                          </div>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {displaySkillDescription(skill)}
                          </p>
                        </div>
                        <Switch
                          checked={skill.enabled}
                          disabled={savingSkill === skill.name}
                          onCheckedChange={checked => void handleToggleSkill(skill, checked)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className={cn('h-full overflow-y-auto py-3', PAGE_INSET_X)}>
          {visibleToolsets.length === 0 ? (
            <EmptyState description={t.skills.noToolsetsDesc} title={t.skills.noToolsetsTitle} />
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {t.skills.toolsetsEnabled(enabledToolsets, toolsets.length)}
              </div>
              <div>
                {visibleToolsets.map(toolset => {
                  const tools = toolNames(toolset)
                  const rawLabel = toolsetDisplayLabel(toolset)
                  const label = displayToolsetName(toolset)
                  const expanded = expandedToolset === toolset.name

                  return (
                    <div className="px-0 py-2.5" key={toolset.name}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{label}</div>
                          <div className="mt-0.5 truncate font-mono text-[0.65rem] text-(--ui-text-tertiary)">
                            {toolset.name || rawLabel}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            aria-expanded={expanded}
                            aria-label={t.skills.configureToolset(label)}
                            className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                            onClick={() =>
                              setExpandedToolset(current => (current === toolset.name ? null : toolset.name))
                            }
                            type="button"
                          >
                            <StatusPill active={toolset.configured}>
                              {toolset.configured ? t.skills.configured : t.skills.needsKeys}
                            </StatusPill>
                          </button>
                          <Switch
                            aria-label={t.skills.toggleToolset(label)}
                            checked={toolset.enabled}
                            disabled={savingToolset === toolset.name}
                            onCheckedChange={checked => void handleToggleToolset(toolset, checked)}
                          />
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {displayToolsetDescription(toolset)}
                      </p>
                      {tools.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {tools.map(name => (
                            <span
                              className="rounded-md bg-(--ui-bg-quinary) px-1.5 py-0.5 font-mono text-[0.65rem] text-(--ui-text-tertiary)"
                              key={name}
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                      {expanded && <ToolsetConfigPanel onConfiguredChange={refreshToolsets} toolset={toolset.name} />}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </PageSearchShell>
  )
}

function StatusPill({ active, children }: { active: boolean; children: string }) {
  return (
    <Badge
      className={
        active ? 'bg-(--ui-bg-tertiary) text-(--ui-text-secondary)' : 'bg-(--ui-bg-quinary) text-(--ui-text-tertiary)'
      }
    >
      {children}
    </Badge>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-52 place-items-center text-center">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-1 text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  )
}
