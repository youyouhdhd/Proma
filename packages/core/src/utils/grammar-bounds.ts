// llama.cpp 工具调用语法的安全限制（src/llama-grammar.cpp 的 MAX_REPETITION_THRESHOLD）。
// 带长度约束的嵌套字符串会被转换成 char{1,N} 定长规则，解析器在
// n_prev_rules × N >= 2000 时直接抛出 "failed to parse grammar"。
export const LLAMA_GRAMMAR_REPETITION_THRESHOLD = 2000

interface JsonSchemaLike {
  type?: string | Array<string>
  items?: unknown
  properties?: Record<string, unknown>
  additionalProperties?: unknown
  anyOf?: Array<unknown>
  oneOf?: Array<unknown>
  allOf?: Array<unknown>
  maxLength?: number
}

/**
 * 收集 JSON Schema 中会触发 llama.cpp 语法解析失败的嵌套字符串 maxLength 值。
 *
 * 只有「工具参数的直接字符串属性」（parameters 的直接 properties，深度 2）
 * 会走 llama.cpp 工具语法的 xml-arg-string 扫描规则，不受长度阈值影响；
 * 其余位置（对象内部、数组元素、anyOf 分支、additionalProperties 等）
 * 都会 JSON 编码为 char{1,N} 定长规则，N 达到阈值即解析失败。
 */
export function findUnsafeNestedStringLengths(schema: unknown, depth = 1, jsonEncoded = false, out: Array<number> = []): Array<number> {
  if (!schema || typeof schema !== 'object') return out
  const node = schema as JsonSchemaLike
  const unsafePosition = depth >= 3 || jsonEncoded
  if (node.type === 'string' && unsafePosition && typeof node.maxLength === 'number' && node.maxLength >= LLAMA_GRAMMAR_REPETITION_THRESHOLD) {
    out.push(node.maxLength)
  }

  const isRoot = depth === 1
  const visit = (child: unknown, viaProperties = false): void => {
    if (!child || typeof child !== 'object') return
    // 根节点经 properties 到达的直接参数仍处于 xml-arg-string 安全区；
    // 其余所有边的子节点都进入 JSON 编码区。
    findUnsafeNestedStringLengths(child, depth + 1, isRoot ? !viaProperties : true, out)
  }

  for (const child of Object.values(node.properties ?? {})) visit(child, true)
  visit(node.items)
  if (typeof node.additionalProperties === 'object' && node.additionalProperties !== null) visit(node.additionalProperties)
  for (const branch of [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]) visit(branch)
  return out
}
