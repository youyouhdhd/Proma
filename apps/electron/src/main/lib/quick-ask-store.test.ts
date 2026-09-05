import { describe, expect, it } from 'bun:test'
import {
  QUICK_ASK_SYSTEM_PROMPT,
  QUICK_ASK_ID_PREFIX,
  appendQuickAskMessage,
  buildQuickAskHistory,
  clearQuickAskSession,
  createQuickAskSession,
  destroyQuickAskSession,
  getQuickAskSession,
} from './quick-ask-store.ts'
import type { ChatMessage } from '@proma/shared'

function makeMessage(partial: Partial<ChatMessage> & Pick<ChatMessage, 'role' | 'content'>): ChatMessage {
  return {
    id: Math.random().toString(36).slice(2),
    createdAt: Date.now(),
    ...partial,
  }
}

describe('createQuickAskSession', () => {
  it('Given 两次创建 When 读取 Then 返回不同的内存会话 ID', () => {
    const a = createQuickAskSession()
    const b = createQuickAskSession()
    expect(a).not.toBe(b)
    expect(a.startsWith(QUICK_ASK_ID_PREFIX)).toBe(true)
    expect(getQuickAskSession(a)?.messages).toEqual([])
  })
})

describe('appendQuickAskMessage', () => {
  it('Given 存在的会话 When 追加消息 Then 按顺序保留在内存中', () => {
    const id = createQuickAskSession()
    const user = makeMessage({ role: 'user', content: '解释一下' })
    const assistant = makeMessage({ role: 'assistant', content: '好的' })
    expect(appendQuickAskMessage(id, user)).toBe(true)
    expect(appendQuickAskMessage(id, assistant)).toBe(true)
    expect(getQuickAskSession(id)?.messages.map((m) => m.content)).toEqual(['解释一下', '好的'])
  })

  it('Given 不存在的会话 When 追加消息 Then 返回 false 且不抛错', () => {
    expect(appendQuickAskMessage('quick-ask-not-exists', makeMessage({ role: 'user', content: 'x' }))).toBe(false)
  })
})

describe('clearQuickAskSession', () => {
  it('Given 已有消息的会话 When 清空 Then 消息归零且会话仍可用', () => {
    const id = createQuickAskSession()
    appendQuickAskMessage(id, makeMessage({ role: 'user', content: 'a' }))
    expect(clearQuickAskSession(id)).toBe(true)
    expect(getQuickAskSession(id)?.messages).toEqual([])
    expect(appendQuickAskMessage(id, makeMessage({ role: 'user', content: 'b' }))).toBe(true)
  })
})

describe('destroyQuickAskSession', () => {
  it('Given 会话 When 销毁 Then 再读取为 null，重复销毁返回 false', () => {
    const id = createQuickAskSession()
    expect(destroyQuickAskSession(id)).toBe(true)
    expect(getQuickAskSession(id)).toBeNull()
    expect(destroyQuickAskSession(id)).toBe(false)
  })
})

describe('buildQuickAskHistory', () => {
  it('Given 历史中混有空内容 assistant 占位 When 组装 Then 空消息被过滤', () => {
    const history = [
      makeMessage({ role: 'user', content: '第一问' }),
      makeMessage({ role: 'assistant', content: '' }),
      makeMessage({ role: 'user', content: '第二问' }),
      makeMessage({ role: 'assistant', content: '回答' }),
    ]
    expect(buildQuickAskHistory(history).map((m) => m.content)).toEqual(['第一问', '第二问', '回答'])
  })

  it('Given 全部有效消息 When 组装 Then 原样保留（含 user 与 assistant）', () => {
    const history = [
      makeMessage({ role: 'user', content: 'q' }),
      makeMessage({ role: 'assistant', content: 'a' }),
    ]
    expect(buildQuickAskHistory(history)).toHaveLength(2)
  })
})

describe('QUICK_ASK_SYSTEM_PROMPT', () => {
  it('Given 系统提示词 Then 声明临时窗隔离与不调用工具的边界', () => {
    expect(QUICK_ASK_SYSTEM_PROMPT).toContain('完全隔离')
    expect(QUICK_ASK_SYSTEM_PROMPT).toContain('不要调用工具')
  })
})
