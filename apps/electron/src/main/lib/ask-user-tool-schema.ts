import { Type } from 'typebox'

/**
 * AskUserQuestion 回答 schema。
 *
 * 必须使用「对象数组」而不是自由 Record：llama.cpp 等后端会把无 additionalProperties
 * 约束的 object schema 展开为通用递归 JSON 语法，再被可选参数的星型重复放大，
 * 直接超过语法解析器的规则数安全上限（"number of rules ... exceeds sane defaults"，
 * 表现为 HTTP 400 "Failed to initialize samplers: failed to parse grammar"）。
 * 对象数组的每条规则都是有界的，即使网关剥离 schema 约束也能安全转换。
 */
export const askUserAnswersSchema = Type.Array(Type.Object({
  question: Type.String({ description: '问题原文，与 questions 中的 question 一致' }),
  answer: Type.String({ description: '对应回答' }),
}), { description: 'AskUserQuestion 的回答' })

/**
 * 把模型按 schema 生成的问题/回答对象数组转换为渲染进程与注入链路使用的
 * Record（问题文本 → 回答文本）。同一条问题重复出现时以后者为准。
 */
export function answersArrayToRecord(
  entries: ReadonlyArray<{ question: string; answer: string }> | undefined,
): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const entry of entries ?? []) {
    answers[entry.question] = entry.answer
  }
  return answers
}
