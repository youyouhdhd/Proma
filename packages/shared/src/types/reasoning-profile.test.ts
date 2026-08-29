import { describe, expect, test } from 'bun:test'
import type { ChannelModelReasoningConfig } from './channel'
import {
  resolveChannelReasoningCapability,
  resolveChannelReasoningEffort,
  resolveReasoningCapability,
  resolveReasoningProfile,
} from './reasoning-profile'

describe('频道模型推理能力声明', () => {
  test('Given 有效档位和映射 When 解析 Then 返回频道 capability', () => {
    const config: ChannelModelReasoningConfig = {
      levels: ['off', 'low', 'medium', 'high'],
      defaultLevel: 'high',
      thinkingLevelMap: { off: 'none', low: 'light' },
    }

    expect(resolveChannelReasoningCapability(config)).toEqual({
      source: 'channel',
      levels: ['off', 'low', 'medium', 'high'],
      defaultLevel: 'high',
    })
    expect(resolveReasoningCapability({ channel: config })).toEqual({
      source: 'channel',
      levels: ['off', 'low', 'medium', 'high'],
      defaultLevel: 'high',
    })
  })

  test('Given 未配置 When 解析 Then 不声明推理能力', () => {
    expect(resolveChannelReasoningCapability(undefined)).toBeUndefined()
    expect(resolveReasoningCapability({})).toBeUndefined()
  })

  test('Given 默认档位不在 levels 中 When 解析 Then 忽略非法声明', () => {
    const config: ChannelModelReasoningConfig = {
      levels: ['off', 'low'],
      defaultLevel: 'high',
    }

    expect(resolveChannelReasoningCapability(config)).toBeUndefined()
  })

  test('Given levels 含运行时非法值 When 解析 Then 过滤非法值并保留有效声明', () => {
    const config = {
      levels: ['off', 'invalid', 'low'],
      defaultLevel: 'low',
    } as unknown as ChannelModelReasoningConfig

    expect(resolveChannelReasoningCapability(config)).toEqual({
      source: 'channel',
      levels: ['off', 'low'],
      defaultLevel: 'low',
    })
  })

  test('Given 会话档位 When 映射 Then 使用频道 effort、null 或默认档位名', () => {
    const config: ChannelModelReasoningConfig = {
      levels: ['off', 'low', 'high'],
      defaultLevel: 'high',
      thinkingLevelMap: { off: 'none', low: ' light ', high: null },
    }

    expect(resolveChannelReasoningEffort(config, 'off')).toBe('none')
    expect(resolveChannelReasoningEffort(config, 'low')).toBe('light')
    expect(resolveChannelReasoningEffort(config, 'high')).toBeNull()
    expect(resolveChannelReasoningEffort(config, 'medium')).toBeUndefined()
    expect(resolveChannelReasoningEffort(config, undefined)).toBeUndefined()
  })

  test('Given 映射缺失或为空 When 映射 Then 原样使用会话档位', () => {
    const withoutMap: ChannelModelReasoningConfig = {
      levels: ['medium'],
      defaultLevel: 'medium',
    }
    const emptyMap: ChannelModelReasoningConfig = {
      levels: ['low'],
      defaultLevel: 'low',
      thinkingLevelMap: { low: '   ' },
    }

    expect(resolveChannelReasoningEffort(withoutMap, 'medium')).toBe('medium')
    expect(resolveChannelReasoningEffort(emptyMap, 'low')).toBe('low')
  })

  test('Given 内置 profile 和频道声明 When 解析 Then profile 优先且行为保持不变', () => {
    const channel: ChannelModelReasoningConfig = {
      levels: ['low', 'high'],
      defaultLevel: 'low',
    }
    const glmProfile = resolveReasoningProfile({ modelId: 'glm-5.3', transport: 'openai-completions' })
    const k3Profile = resolveReasoningProfile({ modelId: 'kimi-k3', transport: 'openai-completions' })
    const deepSeekProfile = resolveReasoningProfile({ modelId: 'deepseek-v4-flash', transport: 'anthropic-messages' })

    expect(glmProfile?.id).toBe('glm-5.3')
    expect(k3Profile?.id).toBe('kimi-k3')
    expect(deepSeekProfile?.id).toBe('deepseek-v4-flash')
    expect(resolveReasoningCapability({ profile: glmProfile, channel })).toEqual({
      source: 'profile',
      levels: ['low', 'high', 'max'],
      defaultLevel: 'max',
    })
  })
})
