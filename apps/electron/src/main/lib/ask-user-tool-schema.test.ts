import { describe, expect, test } from 'bun:test'
import { askUserAnswersSchema, answersArrayToRecord } from './ask-user-tool-schema'

describe('AskUserQuestion answers schema', () => {
  test('使用有界的对象数组而不是自由 Record，避免 llama.cpp 语法规则爆炸', () => {
    const schema = JSON.parse(JSON.stringify(askUserAnswersSchema))

    // 根类型必须是数组：数组的 GBNF 规则是有界的，不会引用通用递归 JSON 语法
    expect(schema.type).toBe('array')

    // 每一项是固定 properties 的对象，不能出现自由 object（Record）
    const items = Array.isArray(schema.items) ? schema.items[0] : schema.items
    expect(items.type).toBe('object')
    expect(Object.keys(items.properties).sort()).toEqual(['answer', 'question'])
    expect(items.additionalProperties).toBeUndefined()
  })

  test('不使用 Type.Record：防止无约束 object 被 llama.cpp 展开为通用递归 JSON 语法', () => {
    // Record 序列化后一定带 additionalProperties（且值为 schema 或 true），这里从反面锁定契约
    const serialized = JSON.stringify(askUserAnswersSchema)
    expect(serialized.includes('"additionalProperties"')).toBe(false)
  })
})

describe('answersArrayToRecord', () => {
  test('把模型生成的对象数组转换为渲染进程注入链路使用的 Record', () => {
    expect(answersArrayToRecord([
      { question: '选择数据库', answer: 'PostgreSQL' },
      { question: '是否迁移', answer: '是' },
    ])).toEqual({
      '选择数据库': 'PostgreSQL',
      '是否迁移': '是',
    })
  })

  test('undefined 与空数组都返回空 Record，保持旧调用兼容', () => {
    expect(answersArrayToRecord(undefined)).toEqual({})
    expect(answersArrayToRecord([])).toEqual({})
  })

  test('同一问题重复出现时以最后一条回答为准', () => {
    expect(answersArrayToRecord([
      { question: '确认?', answer: '否' },
      { question: '确认?', answer: '是' },
    ])).toEqual({ '确认?': '是' })
  })
})
