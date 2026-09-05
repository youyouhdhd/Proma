/**
 * QuickAsk 预填内容构造
 *
 * 从 Agent / Chat 消息的「临时提问」入口把回复内容带入浮窗输入框。
 * 原文过长时截断，避免输入框被超长回复占满。
 */

/** 预填引用内容的最大字符数 */
export const QUICK_ASK_PREFILL_MAX_CHARS = 6000

/**
 * 构造预填文本：附带简短引导语与原文引用。
 * 空内容返回空字符串（调用方直接忽略）。
 */
export function buildQuickAskPrefill(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ''
  if (trimmed.length <= QUICK_ASK_PREFILL_MAX_CHARS) {
    return `请解释这段回复中的内容：\n\n${trimmed}`
  }
  return `请解释这段回复中的内容（原文过长，已截断）：\n\n${trimmed.slice(0, QUICK_ASK_PREFILL_MAX_CHARS)}…`
}
