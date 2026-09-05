/**
 * QuickAskPanel — 临时提问浮窗
 *
 * 一个与 Agent / Chat 会话完全隔离的短暂对话窗口：
 * - 会话仅存于主进程内存，关闭浮窗即销毁，不进入任何会话历史；
 * - 支持独立选择渠道、模型与推理档位；
 * - 可拖动、可缩放，悬浮在任意视图之上；
 * - 定位是解释主对话中难以理解的内容，不提供工具与附件。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { Eraser, Loader2, MessagesSquare, SendHorizontal, Square, X } from 'lucide-react'
import { normalizeReasoningCapabilityLevel, resolveChannelReasoningCapability } from '@proma/shared'
import type { AgentThinkingLevel, ChatMessage } from '@proma/shared'
import {
  quickAskOpenAtom,
  quickAskConversationIdAtom,
  quickAskMessagesAtom,
  quickAskStreamStateAtom,
  quickAskErrorAtom,
  quickAskSelectedModelAtom,
  quickAskReasoningLevelAtom,
  quickAskPrefillAtom,
} from '@/atoms/quick-ask-atoms'
import { channelsAtom, selectedModelAtom } from '@/atoms/chat-atoms'
import type { SelectedModel } from '@/atoms/chat-atoms'
import { ModelSelector } from '@/components/chat/ModelSelector'
import { MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { resolveConversationRequestReasoningLevel } from '@/lib/channel-model-reasoning'

/** 浮窗默认尺寸 */
const PANEL_DEFAULT_WIDTH = 440
const PANEL_DEFAULT_HEIGHT = 560
/** 浮窗尺寸边界 */
const PANEL_MIN_WIDTH = 360
const PANEL_MIN_HEIGHT = 420
/** 距视口边缘的最小间距 */
const VIEWPORT_PADDING = 8

interface PanelGeometry {
  x: number
  y: number
  width: number
  height: number
}

/** 计算默认位置：视口右下角留出边距 */
function defaultGeometry(): PanelGeometry {
  if (typeof window === 'undefined') {
    return { x: 100, y: 100, width: PANEL_DEFAULT_WIDTH, height: PANEL_DEFAULT_HEIGHT }
  }
  const width = Math.min(PANEL_DEFAULT_WIDTH, window.innerWidth - VIEWPORT_PADDING * 2)
  const height = Math.min(PANEL_DEFAULT_HEIGHT, window.innerHeight - VIEWPORT_PADDING * 2)
  return {
    x: window.innerWidth - width - 24,
    y: Math.max(VIEWPORT_PADDING, window.innerHeight - height - 24),
    width,
    height,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** 推理档位显示名 */
const REASONING_LEVEL_LABELS: Record<AgentThinkingLevel, string> = {
  off: '关闭思考',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最大',
}

export function QuickAskPanel(): React.ReactElement | null {
  const store = useStore()
  const open = useAtomValue(quickAskOpenAtom)
  const conversationId = useAtomValue(quickAskConversationIdAtom)
  const messages = useAtomValue(quickAskMessagesAtom)
  const streamState = useAtomValue(quickAskStreamStateAtom)
  const error = useAtomValue(quickAskErrorAtom)
  const customModel = useAtomValue(quickAskSelectedModelAtom)
  const reasoningLevel = useAtomValue(quickAskReasoningLevelAtom)
  const prefill = useAtomValue(quickAskPrefillAtom)
  const globalModel = useAtomValue(selectedModelAtom)
  const channels = useAtomValue(channelsAtom)

  const setOpen = useSetAtom(quickAskOpenAtom)
  const setConversationId = useSetAtom(quickAskConversationIdAtom)
  const setMessages = useSetAtom(quickAskMessagesAtom)
  const setStreamState = useSetAtom(quickAskStreamStateAtom)
  const setError = useSetAtom(quickAskErrorAtom)
  const setCustomModel = useSetAtom(quickAskSelectedModelAtom)
  const setReasoningLevel = useSetAtom(quickAskReasoningLevelAtom)
  const setPrefill = useSetAtom(quickAskPrefillAtom)

  const [geometry, setGeometry] = React.useState<PanelGeometry>(defaultGeometry)
  const [draft, setDraft] = React.useState('')

  // 浮窗独立模型选择；未选择时回退全局默认模型
  const selectedModel: SelectedModel | null = customModel ?? globalModel

  /** 选中模型在渠道中的推理声明 */
  const reasoningCapability = React.useMemo(() => {
    if (!selectedModel) return undefined
    const channel = channels.find((c) => c.id === selectedModel.channelId)
    const config = channel?.models.find((m) => m.id === selectedModel.modelId)?.reasoning
    return resolveChannelReasoningCapability(config)
  }, [channels, selectedModel])

  /** 推理档位候选：声明档位（去除 off）+ 显式关闭项 */
  const reasoningOptions = React.useMemo(() => {
    if (!reasoningCapability) return [] as AgentThinkingLevel[]
    return reasoningCapability.levels.filter((level) => level !== 'off')
  }, [reasoningCapability])

  const effectiveReasoningLevel = reasoningCapability
    ? normalizeReasoningCapabilityLevel(reasoningCapability, reasoningLevel ?? reasoningCapability.defaultLevel)
    : undefined

  // ===== 会话生命周期 =====

  /** 打开时确保临时会话存在 */
  React.useEffect(() => {
    if (!open) return
    if (store.get(quickAskConversationIdAtom)) return
    let cancelled = false
    window.electronAPI.createQuickAskSession()
      .then((result) => {
        if (!cancelled) setConversationId(result.conversationId)
      })
      .catch(console.error)
    return () => { cancelled = true }
  }, [open, store, setConversationId])

  /** 预填内容写入输入框后立即清除 */
  React.useEffect(() => {
    if (!open || prefill == null) return
    setDraft(prefill)
    setPrefill(null)
  }, [open, prefill, setPrefill])

  /** 关闭浮窗：中止生成并销毁内存会话 */
  const closePanel = React.useCallback(() => {
    const id = store.get(quickAskConversationIdAtom)
    if (id) {
      window.electronAPI.destroyQuickAsk(id).catch(console.error)
    }
    setConversationId(null)
    setMessages([])
    setStreamState({ streaming: false, content: '', reasoning: '' })
    setError(null)
    setPrefill(null)
    setOpen(false)
  }, [store, setConversationId, setMessages, setStreamState, setError, setPrefill, setOpen])

  /** 清空对话：保留浮窗与会话容器，仅清消息 */
  const handleClear = React.useCallback(() => {
    const id = store.get(quickAskConversationIdAtom)
    if (id) {
      window.electronAPI.clearQuickAsk(id).catch(console.error)
    }
    setMessages([])
    setStreamState({ streaming: false, content: '', reasoning: '' })
    setError(null)
  }, [store, setMessages, setStreamState, setError])

  // ===== 流式事件订阅（仅浮窗打开期间） =====

  const conversationIdRef = React.useRef(conversationId)
  conversationIdRef.current = conversationId

  React.useEffect(() => {
    if (!open) return

    const appendAssistant = (messageId: string | undefined, stopped = false, errorMessage?: string): void => {
      const state = store.get(quickAskStreamStateAtom)
      const model = selectedModel?.modelId
      if (messageId && state.content.trim()) {
        const message: ChatMessage = {
          id: messageId,
          role: 'assistant',
          content: state.content,
          createdAt: Date.now(),
          model,
          reasoning: state.reasoning || undefined,
          stopped: stopped || undefined,
          error: errorMessage,
        }
        store.set(quickAskMessagesAtom, (prev) => [...prev, message])
      }
      store.set(quickAskStreamStateAtom, { streaming: false, content: '', reasoning: '' })
    }

    const offs = [
      window.electronAPI.onQuickAskStreamChunk((event) => {
        if (event.conversationId !== conversationIdRef.current) return
        store.set(quickAskStreamStateAtom, (prev) => (
          prev.streaming ? { ...prev, content: prev.content + event.delta } : prev
        ))
      }),
      window.electronAPI.onQuickAskStreamReasoning((event) => {
        if (event.conversationId !== conversationIdRef.current) return
        store.set(quickAskStreamStateAtom, (prev) => (
          prev.streaming ? { ...prev, reasoning: prev.reasoning + event.delta } : prev
        ))
      }),
      window.electronAPI.onQuickAskStreamComplete((event) => {
        if (event.conversationId !== conversationIdRef.current) return
        appendAssistant(event.messageId)
      }),
      window.electronAPI.onQuickAskStreamError((event) => {
        if (event.conversationId !== conversationIdRef.current) return
        // 与主进程行为对齐：保留已流出的部分内容，错误信息单独展示
        const state = store.get(quickAskStreamStateAtom)
        if (state.content.trim()) {
          store.set(quickAskMessagesAtom, (prev) => [...prev, {
            id: `quick-ask-error-${Date.now()}`,
            role: 'assistant',
            content: state.content,
            createdAt: Date.now(),
            model: selectedModel?.modelId,
            reasoning: state.reasoning || undefined,
            stopped: true,
            error: event.error,
          }])
        }
        store.set(quickAskStreamStateAtom, { streaming: false, content: '', reasoning: '' })
        store.set(quickAskErrorAtom, event.error)
      }),
    ]
    return () => { offs.forEach((off) => off()) }
  }, [open, store, selectedModel?.modelId])

  // ===== 发送 =====

  const handleSend = React.useCallback(async (): Promise<void> => {
    const text = draft.trim()
    if (!text || !selectedModel || store.get(quickAskStreamStateAtom).streaming) return

    let convId = store.get(quickAskConversationIdAtom)
    if (!convId) {
      try {
        const result = await window.electronAPI.createQuickAskSession()
        convId = result.conversationId
        setConversationId(convId)
      } catch (err) {
        console.error('[QuickAsk] 创建临时会话失败:', err)
        setError('创建临时会话失败')
        return
      }
    }
    if (!convId) return

    const userMessage: ChatMessage = {
      id: `quick-ask-user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      role: 'user',
      content: text,
      createdAt: Date.now(),
    }
    setMessages((prev) => [...prev, userMessage])
    setDraft('')
    setStreamState({ streaming: true, content: '', reasoning: '' })
    setError(null)

    // 推理档位 → 请求参数（与 Chat 主流程同规则）
    let thinkingEnabled: boolean | undefined
    let requestLevel: AgentThinkingLevel | undefined
    if (reasoningCapability) {
      const enabled = (reasoningLevel ?? reasoningCapability.defaultLevel) !== 'off'
      thinkingEnabled = enabled
      requestLevel = resolveConversationRequestReasoningLevel({
        config: channels.find((c) => c.id === selectedModel.channelId)?.models.find((m) => m.id === selectedModel.modelId)?.reasoning,
        selectedLevel: reasoningLevel ?? reasoningCapability.defaultLevel,
        enabled,
      })
    }

    try {
      await window.electronAPI.sendQuickAskMessage({
        conversationId: convId,
        userMessage: text,
        channelId: selectedModel.channelId,
        modelId: selectedModel.modelId,
        thinkingEnabled,
        reasoningLevel: requestLevel,
      })
    } catch (err) {
      console.error('[QuickAsk] 发送失败:', err)
      setError(err instanceof Error ? err.message : '未知错误')
      store.set(quickAskStreamStateAtom, { streaming: false, content: '', reasoning: '' })
    }
  }, [draft, selectedModel, reasoningLevel, reasoningCapability, channels, store, setConversationId, setMessages, setStreamState, setError])

  const handleStop = React.useCallback(() => {
    const id = store.get(quickAskConversationIdAtom)
    if (id) window.electronAPI.stopQuickAsk(id).catch(console.error)
  }, [store])

  // ===== 拖动与缩放 =====

  const dragRef = React.useRef<{ startX: number; startY: number; base: PanelGeometry; mode: 'move' | 'resize' } | null>(null)

  const beginDrag = (mode: 'move' | 'resize') => (event: React.PointerEvent<HTMLElement>): void => {
    if (mode === 'move' && ((event.target as HTMLElement).closest('button'))) return
    event.preventDefault()
    dragRef.current = { startX: event.clientX, startY: event.clientY, base: geometry, mode }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onDragMove = (event: React.PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    setGeometry(() => {
      if (drag.mode === 'resize') {
        return {
          ...drag.base,
          width: clamp(drag.base.width + dx, PANEL_MIN_WIDTH, window.innerWidth - drag.base.x - VIEWPORT_PADDING),
          height: clamp(drag.base.height + dy, PANEL_MIN_HEIGHT, window.innerHeight - drag.base.y - VIEWPORT_PADDING),
        }
      }
      return {
        ...drag.base,
        x: clamp(drag.base.x + dx, VIEWPORT_PADDING, window.innerWidth - drag.base.width - VIEWPORT_PADDING),
        y: clamp(drag.base.y + dy, VIEWPORT_PADDING, window.innerHeight - drag.base.height - VIEWPORT_PADDING),
      }
    })
  }

  const endDrag = (): void => { dragRef.current = null }

  // ===== 自动滚动 =====

  const scrollRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, streamState.content, streamState.reasoning])

  // ===== 渲染 =====

  if (!open) return null

  const inputDisabled = streamState.streaming || !selectedModel

  return (
    <div
      className="fixed z-[70] flex flex-col rounded-xl border border-border/70 bg-background shadow-2xl"
      style={{ left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }}
      role="dialog"
      aria-label="临时提问"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented && !e.nativeEvent.isComposing) closePanel()
      }}
    >
      {/* 标题栏（拖动区） */}
      <div
        className="flex cursor-grab items-center gap-2 rounded-t-xl border-b border-border/60 bg-muted/50 px-3 py-2 select-none active:cursor-grabbing"
        onPointerDown={beginDrag('move')}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-medium leading-tight">临时提问</span>
          <span className="text-[10px] leading-tight text-muted-foreground/70">不进入会话历史 · 关闭即销毁</span>
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={handleClear}
            disabled={messages.length === 0 && !streamState.streaming}
            aria-label="清空对话"
            title="清空对话"
          >
            <Eraser className="size-3.5" />
          </button>
          <button
            type="button"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={closePanel}
            aria-label="关闭临时提问"
            title="关闭"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 scrollbar-thin">
        {messages.length === 0 && !streamState.streaming ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessagesSquare className="size-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">把主对话里难以理解的内容粘贴到这里</p>
            <p className="text-xs text-muted-foreground/60">这段对话完全独立，不会影响当前会话上下文</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((message) => (
              <QuickAskMessageItem key={message.id} message={message} />
            ))}
            {streamState.streaming && (
              <QuickAskStreamingBubble content={streamState.content} reasoning={streamState.reasoning} />
            )}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-3 mb-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-start gap-1.5">
          <span className="flex-1 break-all">{error}</span>
          <button
            type="button"
            className="shrink-0 rounded p-0.5 hover:bg-destructive/10"
            onClick={() => setError(null)}
            aria-label="关闭错误提示"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* 输入区 */}
      <div className="border-t border-border/60 px-3 pb-2 pt-2">
        <div className="mb-2 flex items-center gap-2">
          <ModelSelector
            externalSelectedModel={selectedModel ? { channelId: selectedModel.channelId, modelId: selectedModel.modelId } : null}
            onModelSelect={(option) => {
              setCustomModel({ channelId: option.channelId, modelId: option.modelId })
              // 切换模型后清档位选择，交给新模型的默认档位
              setReasoningLevel(undefined)
            }}
            showChannelInTrigger
            excludedProviders={['openai-codex', 'xai']}
          />
          {reasoningCapability && reasoningOptions.length > 0 && (
            <Select
              value={effectiveReasoningLevel}
              onValueChange={(level) => setReasoningLevel(level as AgentThinkingLevel)}
            >
              <SelectTrigger
                className="h-7 w-auto min-w-[52px] border-0 bg-transparent px-2 text-xs font-medium text-foreground/70 shadow-none hover:bg-muted/50 hover:text-foreground focus:ring-0"
                aria-label="推理档位"
                title="选择推理档位"
              >
                <SelectValue placeholder="推理强度" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">关闭思考</SelectItem>
                {reasoningOptions.map((level) => (
                  <SelectItem key={level} value={level}>{REASONING_LEVEL_LABELS[level] ?? level}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder={selectedModel ? '输入问题，Enter 发送' : '请先在上方选择模型'}
            disabled={!selectedModel}
            rows={2}
            className="max-h-28 min-h-[52px] flex-1 resize-none rounded-lg border border-border/60 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/50 focus-visible:border-primary/50 scrollbar-thin"
          />
          {streamState.streaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive transition-colors hover:bg-destructive/20"
              aria-label="停止生成"
              title="停止生成"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={inputDisabled || !draft.trim()}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              aria-label="发送"
              title="发送"
            >
              <SendHorizontal className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* 右下角缩放手柄 */}
      <div
        className="absolute bottom-0 right-0 size-4 cursor-nwse-resize"
        onPointerDown={beginDrag('resize')}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-hidden="true"
      />
    </div>
  )
}

/** 单条消息渲染 */
function QuickAskMessageItem({ message }: { message: ChatMessage }): React.ReactElement {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-primary/10 px-3 py-2 text-sm">
          {message.content}
        </div>
      </div>
    )
  }
  return (
    <div className={cn('max-w-[96%] text-sm', message.error && 'text-muted-foreground')}>
      {message.reasoning && (
        <Reasoning defaultOpen={false}>
          <ReasoningTrigger />
          <ReasoningContent>{message.reasoning}</ReasoningContent>
        </Reasoning>
      )}
      {message.content ? (
        <MessageResponse>{message.content}</MessageResponse>
      ) : message.error ? (
        <p className="text-destructive">{message.error}</p>
      ) : null}
      {message.stopped && !message.error && (
        <p className="mt-1 text-xs text-muted-foreground/60">已被中止</p>
      )}
    </div>
  )
}

/** 流式中的回复气泡 */
function QuickAskStreamingBubble({ content, reasoning }: { content: string; reasoning: string }): React.ReactElement {
  return (
    <div className="max-w-[96%] text-sm">
      {reasoning && (
        <Reasoning isStreaming defaultOpen={false}>
          <ReasoningTrigger />
          <ReasoningContent>{reasoning}</ReasoningContent>
        </Reasoning>
      )}
      {content ? (
        <MessageResponse>{content}</MessageResponse>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          思考中…
        </span>
      )}
    </div>
  )
}
