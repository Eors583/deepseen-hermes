import { describe, expect, it } from 'vitest'

import { filterDeepseenProductionModelOptions } from './production-model-filter'

describe('production model filter', () => {
  it('keeps only available Deepseen production models in a fixed order', () => {
    const result = filterDeepseenProductionModelOptions({
      model: 'gpt-4o-mini',
      provider: 'openai-api',
      providers: [
        {
          models: ['gpt-4o', 'gpt-5.5', 'gemini-3.1-pro-preview'],
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
      'gpt-5.5',
      'gemini-3.1-pro-preview'
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
