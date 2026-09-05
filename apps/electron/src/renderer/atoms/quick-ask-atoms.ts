/**
 * QuickAsk 临时提问浮窗状态
 *
 * 浮窗状态全部在内存中：关闭即销毁临时会话，不写入任何会话历史。
 * 渠道/模型选择在多次打开之间保留，避免每次都要重新选择。
 */

import { atom } from 'jotai'
import type { AgentThinkingLevel, ChatMessage } from '@proma/shared'
import type { SelectedModel } from './chat-atoms'

/** 浮窗是否打开 */
export const quickAskOpenAtom = atom(false)

/** 当前临时会话 ID（仅内存有效，关闭浮窗即销毁） */
export const quickAskConversationIdAtom = atom<string | null>(null)

/** 临时会话消息列表 */
export const quickAskMessagesAtom = atom<ChatMessage[]>([])

/** 流式状态 */
export interface QuickAskStreamState {
  /** 是否正在流式输出 */
  streaming: boolean
  /** 已累积的回复内容 */
  content: string
  /** 已累积的推理内容 */
  reasoning: string
}

export const quickAskStreamStateAtom = atom<QuickAskStreamState>({
  streaming: false,
  content: '',
  reasoning: '',
})

/** 流式错误信息 */
export const quickAskErrorAtom = atom<string | null>(null)

/** 浮窗独立选择的渠道与模型（null 时回退全局默认模型） */
export const quickAskSelectedModelAtom = atom<SelectedModel | null>(null)

/** 浮窗推理档位选择（undefined 时使用频道默认档位） */
export const quickAskReasoningLevelAtom = atom<AgentThinkingLevel | undefined>(undefined)

/** 打开浮窗时预填到输入框的内容（用后即清） */
export const quickAskPrefillAtom = atom<string | null>(null)
