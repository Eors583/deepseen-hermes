import type { ModelOptionProvider, ModelOptionsResponse } from '@/types/hermes'

import { HERBOUND_PRODUCTION_MODELS } from '@/lib/herbound-production-models'

function modelCandidates(model: (typeof HERBOUND_PRODUCTION_MODELS)[number]): string[] {
  return [model.id, ...(model.aliases ?? [])]
}

function firstMatchingModel(provider: ModelOptionProvider, model: (typeof HERBOUND_PRODUCTION_MODELS)[number]): string {
  const available = new Set((provider.models ?? []).map(value => String(value)))

  return modelCandidates(model).find(candidate => available.has(candidate)) ?? model.id
}

function findProvider(options: ModelOptionsResponse, slug: 'kie' | 'openai-api'): ModelOptionProvider | null {
  const providers = options.providers ?? []
  if (slug === 'kie') {
    return (
      providers.find(provider => String(provider.slug || '').toLowerCase() === 'kie') ??
      providers.find(provider => String(provider.name || '').toLowerCase().includes('kie')) ??
      null
    )
  }
  return (
    providers.find(provider => String(provider.slug || '').toLowerCase() === 'openai-api') ??
    providers.find(provider => String(provider.name || '').toLowerCase().includes('openai')) ??
    null
  )
}

function productionProvider(options: ModelOptionsResponse, slug: 'kie' | 'openai-api'): ModelOptionProvider | null {
  const source = findProvider(options, slug)

  if (!source) {
    return null
  }

  const configuredModels = HERBOUND_PRODUCTION_MODELS.filter(model => model.provider === slug)
  const models = configuredModels.map(model => firstMatchingModel(source, model))
  const allowed = new Set(models)
  const pricing = source.pricing
    ? Object.fromEntries(Object.entries(source.pricing).filter(([model]) => allowed.has(model)))
    : undefined
  const capabilities = source.capabilities
    ? Object.fromEntries(Object.entries(source.capabilities).filter(([model]) => allowed.has(model)))
    : undefined

  return {
    ...source,
    name: source.name || (slug === 'kie' ? 'KIE.AI' : 'OPENAI-API'),
    slug: source.slug || slug,
    models,
    total_models: models.length,
    ...(pricing ? { pricing } : {}),
    ...(capabilities ? { capabilities } : {}),
    unavailable_models: (source.unavailable_models ?? []).filter(model => allowed.has(String(model)))
  }
}

export function filterDeepseenProductionModelOptions(options?: ModelOptionsResponse | null): ModelOptionsResponse | undefined {
  if (!options) {
    return undefined
  }

  return {
    ...options,
    providers: (['openai-api', 'kie'] as const)
      .map(slug => productionProvider(options, slug))
      .filter((provider): provider is ModelOptionProvider => provider !== null && (provider.models ?? []).length > 0)
  }
}
