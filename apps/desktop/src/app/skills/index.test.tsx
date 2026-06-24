import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSkills = vi.fn()
const getToolsets = vi.fn()
const toggleSkill = vi.fn()
const toggleToolset = vi.fn()
const getToolsetConfig = vi.fn()
const selectToolsetProvider = vi.fn()

vi.mock('@/hermes', () => ({
  getSkills: () => getSkills(),
  getToolsets: () => getToolsets(),
  toggleSkill: (name: string, enabled: boolean) => toggleSkill(name, enabled),
  toggleToolset: (name: string, enabled: boolean) => toggleToolset(name, enabled),
  getToolsetConfig: (name: string) => getToolsetConfig(name),
  selectToolsetProvider: (toolset: string, provider: string) => selectToolsetProvider(toolset, provider),
  deleteEnvVar: vi.fn(),
  revealEnvVar: vi.fn(),
  setEnvVar: vi.fn()
}))

// Notifications hit nanostores/timers we don't care about here.
vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

function toolset(overrides: Record<string, unknown> = {}) {
  return {
    name: 'web',
    label: 'Web Search',
    description: 'web_search, web_extract',
    enabled: true,
    available: true,
    configured: true,
    tools: ['web_search', 'web_extract'],
    ...overrides
  }
}

function renderSkills(initialEntry = '/skills?tab=toolsets') {
  return import('./index').then(({ SkillsView }) =>
    render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <SkillsView />
      </MemoryRouter>
    )
  )
}

beforeEach(() => {
  getSkills.mockResolvedValue([])
  getToolsets.mockResolvedValue([toolset()])
  toggleToolset.mockResolvedValue({ ok: true, name: 'web', enabled: false })
  getToolsetConfig.mockResolvedValue({ has_category: false, active_provider: null, providers: [] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SkillsView toolset management', () => {
  it('highlights DeepSeen skills ahead of supporting skills', async () => {
    getSkills.mockResolvedValue([
      {
        name: 'codex',
        description: 'coding skill',
        category: 'software-development',
        enabled: true
      },
      {
        name: 'crossborder-deepseen',
        description: 'DeepSeen crossborder analysis',
        category: 'crossborder-deepseen',
        enabled: true
      }
    ])

    await renderSkills('/skills?tab=skills')

    expect(await screen.findByText('DeepSeen 核心技能')).toBeTruthy()
    expect(screen.getByText('辅助技能')).toBeTruthy()
    expect(screen.getByText('展开高级辅助技能')).toBeTruthy()
    expect(screen.queryByText('Codex 协作')).toBeNull()

    fireEvent.click(screen.getByText('展开高级辅助技能'))
    expect(await screen.findByText('Codex 协作')).toBeTruthy()
  })

  it('highlights DeepSeen toolsets ahead of supporting toolsets', async () => {
    getToolsets.mockResolvedValue([
      toolset(),
      toolset({
        name: 'deepseen',
        label: 'DeepSeen Tools',
        description: 'deepseen tools',
        tools: ['deepseen_competitor_analyze_multi_and_wait']
      })
    ])

    await renderSkills()

    expect(await screen.findByText('DeepSeen 工具链')).toBeTruthy()
    expect(screen.getByText('辅助工具')).toBeTruthy()
    expect(screen.getByText('展开高级辅助工具')).toBeTruthy()
    expect(screen.queryByText('网页搜索')).toBeNull()

    fireEvent.click(screen.getByText('展开高级辅助工具'))
    expect(await screen.findByText('网页搜索')).toBeTruthy()
  })

  it('renders a switch for each toolset and toggles it off', async () => {
    await renderSkills()

    const sw = await screen.findByRole('switch', { name: '切换 网页搜索 工具集' })
    expect(sw.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(sw)

    await waitFor(() => expect(toggleToolset).toHaveBeenCalledWith('web', false))
  })

  it('renders toolset titles without leading emoji', async () => {
    getToolsets.mockResolvedValue([
      toolset({ name: 'cronjob', label: '⏰ Cron Jobs', description: 'cron tools' })
    ])

    await renderSkills()

    expect(await screen.findByText('定时任务')).toBeTruthy()
    expect(screen.queryByText(/⏰/)).toBeNull()
  })

  it('keeps the configured pill alongside the switch', async () => {
    await renderSkills()

    await screen.findByRole('switch', { name: '切换 网页搜索 工具集' })
    expect(screen.getByText('已配置')).toBeTruthy()
  })

  it('expands the provider config panel when the configured pill is clicked', async () => {
    await renderSkills()

    const configureBtn = await screen.findByRole('button', { name: '配置 网页搜索' })
    fireEvent.click(configureBtn)

    await waitFor(() => expect(getToolsetConfig).toHaveBeenCalledWith('web'))
  })
})
