/**
 * QuickAsk 临时提问存储（纯内存）
 *
 * 会话只存在于主进程内存：不写 JSONL、不写 conversations.json 索引，
 * 销毁后即彻底消失，保证不污染任何 Agent / Chat 会话的持久化数据。
 *
 * 纯逻辑与 Electron 解耦，便于 BDD 测试直接覆盖。
 */

import { randomUUID } from 'node:crypto'
import type { ChatMessage } from '@proma/shared'

/**
 * 临时提问的默认系统提示词。
 *
 * 定位是解释助手：不调用工具、不臆造主对话的上下文，
 * 用户未粘贴的内容一律以提问为准。
 */
export const QUICK_ASK_SYSTEM_PROMPT = [
  '你是 Proma 的临时解释助手，运行在一个与主对话完全隔离的小窗中。',
  '用户会把主对话中难以理解的内容粘贴进来，或直接提问。',
  '请用通俗、简洁的中文解释：先给结论，再展开必要的细节。',
  '你看不到主对话的上下文，用户没有提供的背景不要臆测；',
  '如需更多信息，直接指出缺少什么并给出示例。不要调用工具。',
].join('\n')

/** 内存中的临时会话 */
export interface QuickAskSession {
  /** 临时会话 ID */
  conversationId: string
  /** 消息列表（与 ChatMessage 共用类型，渲染层可直接渲染） */
  messages: ChatMessage[]
  /** 创建时间戳 */
  createdAt: number
}

/** 会话 ID 前缀：便于日志与调试识别，不参与路由 */
export const QUICK_ASK_ID_PREFIX = 'quick-ask-'

/** 所有活跃临时会话（conversationId → session） */
const sessions = new Map<string, QuickAskSession>()

/** 创建临时会话，返回会话 ID */
export function createQuickAskSession(): string {
  const conversationId = QUICK_ASK_ID_PREFIX + randomUUID()
  sessions.set(conversationId, {
    conversationId,
    messages: [],
    createdAt: Date.now(),
  })
  return conversationId
}

/** 获取临时会话；不存在时返回 null */
export function getQuickAskSession(conversationId: string): QuickAskSession | null {
  return sessions.get(conversationId) ?? null
}

/** 追加一条消息；会话不存在时返回 false */
export function appendQuickAskMessage(conversationId: string, message: ChatMessage): boolean {
  const session = sessions.get(conversationId)
  if (!session) return false
  session.messages.push(message)
  return true
}

/** 清空会话消息（保留会话本身，供「清空对话」按钮复用） */
export function clearQuickAskSession(conversationId: string): boolean {
  const session = sessions.get(conversationId)
  if (!session) return false
  session.messages = []
  return true
}

/** 销毁会话；关闭浮窗时调用 */
export function destroyQuickAskSession(conversationId: string): boolean {
  return sessions.delete(conversationId)
}

/**
 * 组装发送给模型的历史消息。
 *
 * 过滤掉空内容的 assistant 消息（错误占位等），与 Chat 主流程的
 * 过滤规则保持一致；临时窗不支持分隔线与轮数裁剪，保留全部历史。
 */
export function buildQuickAskHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((msg) => !(msg.role === 'assistant' && !msg.content.trim()))
}
