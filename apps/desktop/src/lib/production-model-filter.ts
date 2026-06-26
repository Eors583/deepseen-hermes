import type { ModelOptionProvider, ModelOptionsResponse } from '@/types/hermes'

const HIDDEN_PROVIDERS = new Set(['gemini'])

const OPENAI_API_ALLOWED_MODELS = new Set([
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'gpt-5-mini',
  'gpt-4.1',
  'gpt-4o',
  'gpt-4o-mini'
])

function filterProvider(provider: ModelOptionProvider): ModelOptionProvider | null {
  const slug = String(provider.slug || '').trim().toLowerCase()
  if (HIDDEN_PROVIDERS.has(slug)) {
    return null
  }

  if (slug !== 'openai-api') {
    return provider
  }

  const models = (provider.models ?? []).filter(model => OPENAI_API_ALLOWED_MODELS.has(String(model)))
  if (models.length === 0) {
    return null
  }

  const allowed = new Set(models)
  const pricing = provider.pricing
    ? Object.fromEntries(Object.entries(provider.pricing).filter(([model]) => allowed.has(model)))
    : undefined
  const capabilities = provider.capabilities
    ? Object.fromEntries(Object.entries(provider.capabilities).filter(([model]) => allowed.has(model)))
    : undefined

  return {
    ...provider,
    models,
    total_models: models.length,
    ...(pricing ? { pricing } : {}),
    ...(capabilities ? { capabilities } : {}),
    unavailable_models: (provider.unavailable_models ?? []).filter(model => allowed.has(String(model)))
  }
}

export function filterHerboundProductionModelOptions(options?: ModelOptionsResponse | null): ModelOptionsResponse | undefined {
  if (!options) {
    return undefined
  }

  return {
    ...options,
    providers: (options.providers ?? [])
      .map(filterProvider)
      .filter((provider): provider is ModelOptionProvider => provider !== null)
  }
}
