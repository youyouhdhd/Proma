import { describe, expect, it } from 'bun:test'
import { QUICK_ASK_PREFILL_MAX_CHARS, buildQuickAskPrefill } from './quick-ask-prefill.ts'

describe('buildQuickAskPrefill', () => {
  it('Given 普通回复内容 When 构造预填 Then 附带引导语并保留原文', () => {
    const result = buildQuickAskPrefill('  这是一段难以理解的回复  ')
    expect(result.startsWith('请解释这段回复中的内容：')).toBe(true)
    expect(result.endsWith('这是一段难以理解的回复')).toBe(true)
  })

  it('Given 空白内容 When 构造预填 Then 返回空字符串', () => {
    expect(buildQuickAskPrefill('')).toBe('')
    expect(buildQuickAskPrefill('   \n  ')).toBe('')
  })

  it('Given 超长回复 When 构造预填 Then 截断到上限并带省略标记', () => {
    const result = buildQuickAskPrefill('a'.repeat(QUICK_ASK_PREFILL_MAX_CHARS + 100))
    expect(result).toContain('已截断')
    expect(result.length).toBeLessThan(QUICK_ASK_PREFILL_MAX_CHARS + 100)
    expect(result.endsWith('…')).toBe(true)
  })
})
