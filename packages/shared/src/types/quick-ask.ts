/**
 * QuickAsk 临时提问浮窗类型定义
 *
 * 浮窗中的对话完全独立于 Agent / Chat 会话：
 * - 仅存在于主进程内存，不写任何 JSONL / 索引文件；
 * - 关闭浮窗或应用退出即销毁，不会进入会话历史；
 * - 用于对当前回答中难以理解的内容做简短追问和解释。
 */

import type { AgentThinkingLevel } from './agent'

/**
 * QuickAsk 相关 IPC 通道常量
 */
export const QUICK_ASK_IPC_CHANNELS = {
  /** 创建临时会话（仅内存） */
  CREATE_SESSION: 'quick-ask:create-session',
  /** 发送消息（触发流式响应） */
  SEND_MESSAGE: 'quick-ask:send-message',
  /** 中止生成 */
  STOP: 'quick-ask:stop',
  /** 清空当前临时会话消息 */
  CLEAR: 'quick-ask:clear',
  /** 销毁临时会话（关闭浮窗时调用） */
  DESTROY: 'quick-ask:destroy',

  // 流式事件（主进程 → 渲染进程推送）
  /** 内容片段 */
  STREAM_CHUNK: 'quick-ask:stream:chunk',
  /** 推理片段 */
  STREAM_REASONING: 'quick-ask:stream:reasoning',
  /** 流式完成 */
  STREAM_COMPLETE: 'quick-ask:stream:complete',
  /** 流式错误 */
  STREAM_ERROR: 'quick-ask:stream:error',
} as const

/** 创建临时会话的结果 */
export interface QuickAskCreateResult {
  /** 临时会话 ID（仅内存有效） */
  conversationId: string
}

/**
 * 发送临时提问的输入参数
 *
 * 不支持附件与工具：临时窗的定位是轻量解释，避免引入工作区副作用。
 */
export interface QuickAskSendInput {
  /** 临时会话 ID */
  conversationId: string
  /** 用户消息内容 */
  userMessage: string
  /** 渠道 ID */
  channelId: string
  /** 模型 ID */
  modelId: string
  /** 是否启用思考模式 */
  thinkingEnabled?: boolean
  /** 本次请求的推理档位 */
  reasoningLevel?: AgentThinkingLevel
}
