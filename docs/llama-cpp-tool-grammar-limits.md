# llama.cpp 工具语法限制与 Agent 模式 400 排查记录

- 日期：2026-09-03
- 影响版本：Proma <= 0.19.8（已修复于 0.19.9）
- 适用场景：任何「OpenAI Chat 格式 + llama.cpp 系后端（llama-server / llama-swap / Ollama 等）」的 Agent 模式接入

## 现象

自建 API（NewAPI 网关 → llama.cpp 后端，Qwen 3 8B / 27B）：

- **Chat 模式**（不发工具定义）：完全正常；
- **Agent 模式**（携带全量工具 schema）：请求一发出就 400：

  ```json
  {"message":"Failed to initialize samplers: failed to parse grammar","type":"invalid_request_error","code":400}
  ```

  llama.cpp 服务端日志同时打印完整 GBNF 与：

  ```
  parse: error parsing grammar: number of rules that are going to be repeated
  multiplied by the new repetition exceeds sane defaults
  ```

NewAPI 重试链路上的 502（渠道 3）是渠道 1 报错后的连带失败，不是独立问题。

## 排查过程

### 第一轮（0.19.8，方向正确但没打中要害）

从 llama.cpp 日志的 GBNF 转储中发现两个工具的 `answers` 字段被编译成通用递归 object 规则：

```
tool-AskUserQuestion-arg-answers-schema ::= object
tool-mcp-collaboration-answer-delegation-question-arg-answers-schema ::= object
```

原因：`Type.Record(String, String)` 经 NewAPI 剥离 `additionalProperties` 后变成无约束 `{"type":"object"}`。
0.19.8 把两处都改成了有界的对象数组（`apps/electron/src/main/lib/ask-user-tool-schema.ts`）。
修复本身是好的（对有 JSON Schema 约束解码的其他后端同样必要），但装上后报错依旧。

### 第二轮（0.19.9，定位真凶）

关键线索：GBNF 转储里同样带 `maxLength` 的字段呈现两种形态：

```
# 顶层参数：安全，走扫描规则，maxLength 被忽略
tool-BrowserWaitFor-arg-value ::= ("<parameter=" "value" ">\n") xml-arg-string
tool-BrowserDomAction-arg-text ::= ("<parameter=" "text" ">\n") xml-arg-string

# 嵌套字段：被 JSON 编码成定长规则 —— 唯一的 char{1,2000}
tool-BrowserAct-arg-waitFor-schema-value ::= "\"" char{1,2000} "\""
```

对照 llama.cpp 源码 `src/llama-grammar.cpp`（注意仓库已迁移到 ggml-org 组织）：

```cpp
#define MAX_REPETITION_THRESHOLD 2000

// handle_repetitions() 中：
// total_rules 对有界重复 {m,n} 取 max_times，对 * 和 ? 取 1
if (n_prev_rules * total_rules >= MAX_REPETITION_THRESHOLD) {
    throw std::runtime_error("number of rules that are going to be repeated "
        "multiplied by the new repetition exceeds sane defaults, ...");
}
```

`char{1,2000}` → 1 × 2000 = 2000，**正好命中上限**，所以 Agent 模式 100% 失败。

### llama.cpp 工具语法的两条铁律（结论）

1. **顶层工具参数的字符串**（parameters 的直接 properties）→ `xml-arg-string`
   扫描规则（扫到 `</parameter>` 为止），**不生成定长重复，maxLength 不生效、无风险**。
2. **嵌套位置**（对象内部、数组元素、anyOf 分支、additionalProperties）的带约束字符串
   → JSON 编码为 `"\"" char{m,N} "\""`，当 `N ≥ 2000` 时解析器直接抛错。

注意：`Type.Object({})`（空 properties）、无约束的 `string`（`char*`）、
`{0,19}` 这类小 bound 都是安全的；唯一炸点是**嵌套 + maxLength ≥ 2000** 的组合。

## 修复内容（0.19.9）

| 文件 | 改动 |
| --- | --- |
| `apps/electron/src/main/lib/adapters/pi-builtin-tools.ts` | `BrowserAct.waitFor.value` 的 maxLength 从 2000 降到 1024，附原因注释 |
| `packages/core/src/utils/grammar-bounds.ts`（新增） | `findUnsafeNestedStringLengths()`：递归扫描 JSON Schema，按上述两条铁律找出越界的嵌套 maxLength |
| `packages/core/src/providers/openai-adapter.ts` | `toOpenAITools()` 序列化时对每个工具（含 MCP 工具）执行扫描，命中则 `console.warn` 提示 |
| `packages/core/src/utils/grammar-bounds.test.ts`（新增） | 6 个回归用例：顶层安全 / 嵌套 2000 命中 / 嵌套低于阈值安全 / 数组内部 / 顶层数组元素 |
| `apps/electron/src/main/lib/ask-user-tool-schema.ts`（0.19.8 引入，保留） | AskUserQuestion / collaboration 的 answers 改为有界对象数组 + 数组转 Record 适配 |
| 版本 | `@proma/core` 0.2.19、`@proma/electron` 0.19.9 |

验证：`bun test`（相关 10 用例全过）、`bun run typecheck` 六包全绿、`bun run dist:win` 产物 asar 内确认含修复。

## 以后新增/修改工具的检查清单

- [ ] 工具参数的**嵌套**字符串不要设 `maxLength ≥ 2000`（留余量建议 ≤ 1024）；顶层参数随意。
- [ ] 不要用 `Type.Record(String, X)` / 无约束 `{"type":"object"}` 作参数——
      网关剥离 `additionalProperties` 后会被展开为通用递归 JSON 语法；用有界对象数组替代
      （参考 `ask-user-tool-schema.ts` 的模式）。
- [ ] 如果上游报 `failed to parse grammar`：先拿 llama.cpp 日志里的 GBNF 转储，
      搜 `char{` 和 ` ::= object`，前者对照本文件阈值，后者对照 Record 问题。
- [ ] 网关（NewAPI 等）可能剥离 `additionalProperties` / 保留 `maxLength`，本地 schema 正确不代表线上等价。
- [ ] llama.cpp 仓库在 ggml-org 组织下；本网络直连 GitHub 会被拦，可用 `https://r.jina.ai/` 代理读源码。

## 相关日志溯源

- NewAPI 请求 ID：`202609021812406264956188268d9d63fZbpsBY`（渠道 1 A40-ESL-QWEN，400）
- NewAPI 请求 ID：`202609021814033685661498268d9d6fQoxouch`（渠道 3 UIH NEWAPI IN，502 连带）
