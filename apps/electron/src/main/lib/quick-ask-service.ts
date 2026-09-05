/**
 * QuickAsk 临时提问流式服务
 *
 * 与 chat-service.ts 共用 Provider 适配器、API Key 解密与代理配置，
 * 但流程刻意精简：
 * - 不调用工具、不支持附件（临时窗定位是轻量解释，避免工作区副作用）；
 * - 历史只保留在 quick-ask-store 的内存中，绝不落盘；
 * - 流式事件走独立的 QUICK_ASK_IPC_CHANNELS，不干扰 Chat 全局流状态。
 */

import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { QUICK_ASK_IPC_CHANNELS, resolveChannelReasoningEffort } from '@proma/shared'
import type { QuickAskSendInput } from '@proma/shared'
import { getAdapter, streamSSE } from '@proma/core'
import { listChannels, resolveChannelRuntimeApiKey } from './channel-manager'
import { getFetchFn } from './proxy-fetch'
import { getEffectiveProxyUrl } from './proxy-settings-service'
import {
  QUICK_ASK_SYSTEM_PROMPT,
  appendQuickAskMessage,
  buildQuickAskHistory,
  clearQuickAskSession,
  destroyQuickAskSession,
  getQuickAskSession,
} from './quick-ask-store'

/** 活跃的 AbortController 映射（conversationId → controller） */
const activeControllers = new Map<string, AbortController>()

/**
 * 发送临时提问并流式返回响应
 *
 * @param input 发送参数
 * @param webContents 渲染进程 webContents（用于推送流式事件）
 * @returns 是否成功完成
 */
export async function sendQuickAskMessage(
  input: QuickAskSendInput,
  webContents: WebContents,
): Promise<boolean> {
  const { conversationId, userMessage, channelId, modelId, thinkingEnabled, reasoningLevel } = input

  const session = getQuickAskSession(conversationId)
  if (!session) {
    webContents.send(QUICK_ASK_IPC_CHANNELS.STREAM_ERROR, {
      conversationId,
      error: '临时会话已失效，请关闭浮窗后重新打开',
    })
    return false
  }

  const channel = listChannels().find((c) => c.id === channelId)
  if (!channel) {
    webContents.send(QUICK_ASK_IPC_CHANNELS.STREAM_ERROR, {
      conversationId,
      error: '渠道不存在',
    })
    return false
  }

  // Subscription OAuth uses Pi provider-specific transports, which QuickAsk
  // does not implement — same guard as Chat mode.
  if (channel.provider === 'openai-codex' || channel.provider === 'xai') {
    const providerName = channel.provider === 'xai' ? 'xAI（Grok OAuth）' : 'ChatGPT 订阅（Codex OAuth）'
    webContents.send(QUICK_ASK_IPC_CHANNELS.STREAM_ERROR, {
      conversationId,
      error: `临时提问暂不支持 ${providerName}，请切换渠道。`,
    })
    return false
  }

  let apiKey: string
  try {
    apiKey = await resolveChannelRuntimeApiKey(channelId)
  } catch {
    webContents.send(QUICK_ASK_IPC_CHANNELS.STREAM_ERROR, {
      conversationId,
      error: '解密 API Key 失败',
    })
    return false
  }

  const modelReasoning = channel.models.find((model) => model.id === modelId)?.reasoning
  const reasoningEffort = resolveChannelReasoningEffort(modelReasoning, reasoningLevel)

  // 先取历史再追加用户消息，避免适配器重复发送当前消息
  const history = buildQuickAskHistory(session.messages)
  const userMsg = {
    id: randomUUID(),
    role: 'user' as const,
    content: userMessage,
    createdAt: Date.now(),
  }
  appendQuickAskMessage(conversationId, userMsg)

  const controller = new AbortController()
  activeControllers.set(conversationId, controller)

  let accumulatedContent = ''
  let accumulatedReasoning = ''

  try {
    const adapter = getAdapter(channel.provider)
    const proxyUrl = await getEffectiveProxyUrl()
    const fetchFn = getFetchFn(proxyUrl)

    const request = adapter.buildStreamRequest({
      baseUrl: channel.baseUrl,
      apiKey,
      modelId,
      history,
      userMessage,
      systemMessage: QUICK_ASK_SYSTEM_PROMPT,
      // 临时窗不支持附件，提供空实现满足适配器契约
      readImageAttachments: () => [],
      thinkingEnabled,
      reasoningEffort,
    })

    await streamSSE({
      request,
      adapter,
      signal: controller.signal,
      fetchFn,
      onEvent: (event) => {
        if (event.type === 'chunk') {
          accumulatedContent += event.delta ?? ''
          webContents.send(QUICK_ASK_IPC_CHANNELS.STREAM_CHUNK, { conversationId, delta: event.delta })
        } else if (event.type === 'reasoning') {
          accumulatedReasoning += event.delta ?? ''
          webContents.send(QUICK_ASK_IPC_CHANNELS.STREAM_REASONING, { conversationId, delta: event.delta })
        }
      },
    })

    const assistantMsgId = randomUUID()
    if (accumulatedContent.trim()) {
      appendQuickAskMessage(conversationId, {
        id: assistantMsgId,
        role: 'assistant',
        content: accumulatedContent,
        createdAt: Date.now(),
        model: modelId,
        reasoning: accumulatedReasoning || undefined,
      })
    } else {
      console.warn(`[临时提问] 模型返回空内容 (会话 ${conversationId})`)
    }

    webContents.send(QUICK_ASK_IPC_CHANNELS.STREAM_COMPLETE, {
      conversationId,
      model: modelId,
      messageId: accumulatedContent.trim() ? assistantMsgId : undefined,
    })
    return true
  } catch (error) {
    if (controller.signal.aborted) {
      // 用户中止：保留已输出的部分内容
      if (accumulatedContent) {
        const partialMsgId = randomUUID()
        appendQuickAskMessage(conversationId, {
          id: partialMsgId,
          role: 'assistant',
          content: accumulatedContent,
          createdAt: Date.now(),
          model: modelId,
          reasoning: accumulatedReasoning || undefined,
          stopped: true,
        })
        webContents.send(QUICK_ASK_IPC_CHANNELS.STREAM_COMPLETE, {
          conversationId,
          model: modelId,
          messageId: partialMsgId,
        })
      } else {
        webContents.send(QUICK_ASK_IPC_CHANNELS.STREAM_COMPLETE, { conversationId, model: modelId })
      }
      return true
    }

    const errorMessage = error instanceof Error ? error.message : '未知错误'
    console.error('[临时提问] 流式请求失败:', error)

    // 错误信息保留在内存会话中，浮窗内可见即可（销毁即消失）
    if (accumulatedContent) {
      appendQuickAskMessage(conversationId, {
        id: randomUUID(),
        role: 'assistant',
        content: accumulatedContent,
        createdAt: Date.now(),
        model: modelId,
        reasoning: accumulatedReasoning || undefined,
        stopped: true,
        error: errorMessage,
      })
    }

    webContents.send(QUICK_ASK_IPC_CHANNELS.STREAM_ERROR, {
      conversationId,
      error: errorMessage,
    })
    return false
  } finally {
    activeControllers.delete(conversationId)
  }
}

/** 中止指定临时会话的生成 */
export function stopQuickAsk(conversationId: string): void {
  const controller = activeControllers.get(conversationId)
  if (controller) {
    controller.abort()
    activeControllers.delete(conversationId)
  }
}

/** 清空临时会话消息（同时中止进行中的生成） */
export function clearQuickAsk(conversationId: string): void {
  stopQuickAsk(conversationId)
  clearQuickAskSession(conversationId)
}

/** 销毁临时会话（关闭浮窗时调用；同时中止进行中的生成） */
export function destroyQuickAsk(conversationId: string): void {
  stopQuickAsk(conversationId)
  destroyQuickAskSession(conversationId)
}
