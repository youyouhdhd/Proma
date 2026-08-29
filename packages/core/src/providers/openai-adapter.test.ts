import { describe, expect, test } from 'bun:test'
import { OpenAIAdapter } from './openai-adapter.ts'

function buildRequest(reasoningEffort?: string | null) {
  return new OpenAIAdapter().buildStreamRequest({
    baseUrl: 'http://localhost:8001/v1',
    apiKey: 'test',
    modelId: 'qwen3.8-27b-q8',
    history: [],
    userMessage: '你好',
    readImageAttachments: () => [],
    reasoningEffort,
  })
}

describe('OpenAIAdapter reasoning effort', () => {
  test('Given 自建模型推理档位 When buildStreamRequest Then 编码 reasoning_effort', () => {
    const request = buildRequest('low')

    expect(JSON.parse(request.body)).toMatchObject({ reasoning_effort: 'low' })
  })

  test('Given 未配置或显式关闭推理 When buildStreamRequest Then 不发送 reasoning_effort', () => {
    expect(JSON.parse(buildRequest().body)).not.toHaveProperty('reasoning_effort')
    expect(JSON.parse(buildRequest(null).body)).not.toHaveProperty('reasoning_effort')
  })
})
