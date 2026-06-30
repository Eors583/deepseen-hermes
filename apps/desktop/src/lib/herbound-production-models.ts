export interface DeepseenProductionModel {
  aliases?: readonly string[]
  id: string
  label: string
  provider: 'kie' | 'openai-api'
}

export const HERBOUND_PRODUCTION_MODELS: readonly DeepseenProductionModel[] = [
  { id: 'deepseek-v4-pro', label: 'DeepSeek V4.1', provider: 'openai-api', aliases: ['deepseek/deepseek-v4-pro', 'deepseek-v4.1'] },
  { id: 'glm-5.1', label: 'GLM 5.1', provider: 'openai-api', aliases: ['z-ai/glm-5.1', 'zai/glm-5.1'] },
  { id: 'gpt-5-5', label: 'GPT-5.5 Pro', provider: 'kie', aliases: ['gpt-5.5-pro', 'openai/gpt-5.5-pro'] },
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', provider: 'kie', aliases: ['google/gemini-3.1-pro-preview', 'gemini-3.1-pro-preview'] },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'kie', aliases: ['anthropic/claude-sonnet-4.6', 'claude-sonnet-4.6'] },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'kie', aliases: ['anthropic/claude-opus-4.8', 'claude-opus-4.8'] }
]

export const HERBOUND_PRODUCTION_MODEL_LABELS = new Map(
  HERBOUND_PRODUCTION_MODELS.flatMap(model => [
    [model.id, model.label] as const,
    ...((model.aliases ?? []).map(alias => [alias, model.label] as const))
  ])
)
