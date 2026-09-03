import { describe, expect, it } from 'bun:test'
import { findUnsafeNestedStringLengths, LLAMA_GRAMMAR_REPETITION_THRESHOLD } from './grammar-bounds.ts'

describe('findUnsafeNestedStringLengths', () => {
  it('顶层工具参数的大 maxLength 不触发告警（走 xml-arg-string 扫描规则）', () => {
    const schema = {
      type: 'object',
      properties: {
        text: { type: 'string', maxLength: 20_000 },
      },
    }
    expect(findUnsafeNestedStringLengths(schema)).toEqual([])
  })

  it('嵌套字符串 maxLength 达到阈值时会被检出（BrowserAct.waitFor 回归场景）', () => {
    const schema = {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        waitFor: {
          type: 'object',
          properties: {
            kind: { anyOf: [{ const: 'url' }, { const: 'text' }, { const: 'selector' }] },
            value: { type: 'string', minLength: 1, maxLength: 2000 },
          },
        },
      },
    }
    expect(findUnsafeNestedStringLengths(schema)).toEqual([2000])
  })

  it('嵌套字符串 maxLength 低于阈值时安全', () => {
    const schema = {
      type: 'object',
      properties: {
        waitFor: {
          type: 'object',
          properties: {
            value: { type: 'string', minLength: 1, maxLength: 1023 },
          },
        },
      },
    }
    expect(findUnsafeNestedStringLengths(schema)).toEqual([])
  })

  it('数组元素内部的嵌套字符串同样受检', () => {
    const schema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              value: { type: 'string', maxLength: LLAMA_GRAMMAR_REPETITION_THRESHOLD },
            },
          },
        },
      },
    }
    expect(findUnsafeNestedStringLengths(schema)).toEqual([LLAMA_GRAMMAR_REPETITION_THRESHOLD])
  })

  it('顶层数组的受约束字符串元素同样受检', () => {
    const schema = {
      type: 'object',
      properties: {
        filePaths: {
          type: 'array',
          items: { type: 'string', maxLength: 2000 },
        },
      },
    }
    expect(findUnsafeNestedStringLengths(schema)).toEqual([2000])
  })
})
