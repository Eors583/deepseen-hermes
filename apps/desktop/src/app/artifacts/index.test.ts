import { describe, expect, it } from 'vitest'

import type { SessionInfo, SessionMessage } from '@/types/hermes'

import { collectArtifactsForSession } from './index'

function makeSession(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    ended_at: null,
    id: 'session-1',
    input_tokens: 0,
    is_active: false,
    last_active: 1000,
    message_count: 1,
    model: null,
    output_tokens: 0,
    preview: null,
    source: null,
    started_at: 1000,
    title: 'Session',
    tool_call_count: 0,
    ...overrides
  }
}

describe('collectArtifactsForSession', () => {
  it('indexes plain https links from assistant text', () => {
    const artifacts = collectArtifactsForSession(makeSession(), [
      {
        content: 'Reference: https://example.com/docs/getting-started',
        role: 'assistant',
        timestamp: 2000
      }
    ])

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      href: 'https://example.com/docs/getting-started',
      kind: 'link',
      value: 'https://example.com/docs/getting-started'
    })
  })

  it('indexes http links present in tool JSON payloads', () => {
    const messages: SessionMessage[] = [
      {
        content: JSON.stringify({ source_url: 'https://example.com/changelog/latest' }),
        role: 'tool',
        timestamp: 3000
      }
    ]

    const artifacts = collectArtifactsForSession(makeSession({ id: 'session-2' }), messages)

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      href: 'https://example.com/changelog/latest',
      kind: 'link',
      value: 'https://example.com/changelog/latest'
    })
  })

  it('indexes DeepSeen media attachments from assistant markdown', () => {
    const reportPath =
      'D:\\Users\\Administrator\\Desktop\\hermes-agent-main\\.hermes\\deepseen-reports\\deepseen-creator_analysis-20260625-104820.pdf'

    const artifacts = collectArtifactsForSession(makeSession({ id: 'session-3' }), [
      {
        content: `附件下载\n\n- [下载 DeepSeen 完整报告](#media:${encodeURIComponent(reportPath)})`,
        role: 'assistant',
        timestamp: 4000
      }
    ])

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      href:
        'file:///D:/Users/Administrator/Desktop/hermes-agent-main/.hermes/deepseen-reports/deepseen-creator_analysis-20260625-104820.pdf',
      kind: 'file',
      label: 'deepseen-creator_analysis-20260625-104820.pdf',
      value: reportPath
    })
  })
})
