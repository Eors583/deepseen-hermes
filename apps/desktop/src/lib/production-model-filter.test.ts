import { describe, expect, it } from 'vitest'

import { filterDeepseenProductionModelOptions } from './production-model-filter'

describe('production model filter', () => {
  it('keeps the six Deepseen production models in a fixed provider split', () => {
    const result = filterDeepseenProductionModelOptions({
      model: 'gpt-4o-mini',
      provider: 'openai-api',
      providers: [
        {
          models: ['gpt-4o'],
          name: 'OPENAI-API',
          slug: 'openai-api'
        },
        {
          models: ['gpt-5-5', 'gemini-3.1-pro', 'claude-sonnet-4-6', 'claude-opus-4-8'],
          name: 'KIE.AI',
          slug: 'kie'
        },
        {
          models: ['gemini-2.5-pro'],
          name: 'Google',
          slug: 'gemini'
        }
      ]
    })

    expect(result?.providers).toHaveLength(2)
    expect(result?.providers?.[0]).toMatchObject({
      name: 'OPENAI-API',
      slug: 'openai-api',
      total_models: 2
    })
    expect(result?.providers?.[0]?.models).toEqual([
      'deepseek-v4-pro',
      'glm-5.1'
    ])
    expect(result?.providers?.[1]).toMatchObject({
      name: 'KIE.AI',
      slug: 'kie',
      total_models: 4
    })
    expect(result?.providers?.[1]?.models).toEqual([
      'gpt-5-5',
      'gemini-3.1-pro',
      'claude-sonnet-4-6',
      'claude-opus-4-8'
    ])
  })
})
