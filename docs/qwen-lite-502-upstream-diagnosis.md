# qwen-lite 渠道 Agent 会话瞬时 502 排查记录

> 排查日期:2026-09-03
> 现象:Proma Agent 会话使用部署的 qwen-lite 渠道(UIHIN,内网 NewAPI http://10.8.190.10:61080/v1)时反复报"网络暂时中断",502 `{"message":"openai_error","type":"bad_response_status_code"}`,8/8 次自动恢复(指数退避总时长约 107 秒)。

## 结论(先看这里)

**最终定位:渠道协议类型选错。** 该上游是 OpenAI 兼容自建部署,渠道应选择 **OpenAI Chat Completions(自定义地址)**(即 custom 类型),而不是 openai 类型。custom 类型在 Proma 中会强制 system 角色并发送与自建后端兼容的请求形态;openai 类型在 thinking 开启时会把 system prompt 编码为 developer 角色,该部署不识别,稳定返回 502。改选自定义地址类型后问题消失。

其他佐证:同渠道 chat 模式与 Codex 等其他工具始终正常(chat 不发 developer 角色、Codex 走 /v1/responses 协议),只有 Agent 模式受影响;网关侧可见 502,说明请求已到达网关并由上游拒绝。

排查期间曾误判为"上游多通道坏副本/间歇故障",已纠正:失败会话中成功轮与失败轮分属不同模型部署(qwen3.8-27b-q8 与 qwen-lite),developer 角色随 thinking 配置有无而隐现,才造成"时好时坏"的假象。

## 排查方法(下次可直接复用)

### 1. 会话时间线分析

失败会话存于 `C:\Users\MOVE\.proma\sdk-config\sessions\*.jsonl`。过滤 `role=assistant` 条目看 `stopReason`(stop=成功/error=失败)和 usage,注意指数退避间隔(约 1.3s/2.6s/4.3s/8.3s/16.3s/32.3s/64.3s/128.3s,总计约 107s,即 UI 显示的"107 秒后第 8/8 次")。同时检查 `model_change`(确认渠道 provider 类型)与 `thinking_level_change`。

### 2. 直连测试(核心手段)

Proma 渠道密钥是 Electron safeStorage 加密,Windows 上为 **Chromium os_crypt 格式**:

- 密文:base64,前 3 字节是 ASCII "v10",接下来 12 字节是 AES-GCM nonce,剩余为密文+16 字节 tag
- AES 密钥:`%APPDATA%\@proma\electron\Local State` 的 `os_crypt.encrypted_key`(base64,剥 5 字节 "DPAPI" 前缀后用 DPAPI CurrentUser 解密,得到 32 字节 AES-256 密钥)
- 解密必须用 **pwsh 7**(Windows PowerShell 5.1 的 .NET Framework 没有 AesGcm 类);临时脚本中用 `[Security.Cryptography.AesGcm]::Decrypt(nonce, ct, tag, plain)` 三参数重载(注意 tag 必须单独拆出,不能和密文连在一起传)
- **密钥只在内存中使用,任何输出都必须脱敏**

测试矩阵(全部应通过,失败项才是线索):

| 测试项 | 内容 |
| --- | --- |
| T1 | 最小 chat(流式/非流式) |
| T2 | + tools 数组(流式/非流式) |
| T3 | 分别加 `reasoning_effort` / `enable_thinking` / `chat_template_kwargs` |
| T4 | 大上下文(~48KB 文本) |
| T5 | 最小请求重复 5 轮(验证间歇性) |
| S1 | Agent 形态压力:8 tools + 流式 + ~15k token 历史,重复 5 轮 |
| S2/S3 | qwen3.8-27b-q8 最小请求 + Agent 形态流式 |

### 3. pi runtime 的 thinking 参数(已确认不是本次原因)

`@earendil-works/pi-coding-agent` 的 openai-completions 适配器会按模型的 thinkingFormat 发送三种参数之一:`enable_thinking`(qwen 格式)、`chat_template_kwargs:{enable_thinking, preserve_thinking}`(qwen-chat-template 格式)、或 `reasoning_effort`(标准 OpenAI 格式)。本次上游对三种都兼容(实测 200)。若未来上游报 400/422 且提示参数错误,优先怀疑这里。

## 与上一个 bug 的区分

| | Agent 模式 400 "failed to parse grammar" | 本次 502 |
| --- | --- | --- |
| 错误来源 | llama.cpp 后端 grammar 解析器 | 上游不识别 developer 角色(渠道类型选错) |
| 可复现性 | 稳定复现(嵌套字符串 maxLength≥2000 触发) | 稳定复现(thinking 开启时 100%) |
| 解决方式 | 已修复(maxLength 2000→1024 + 语法边界扫描器) | 渠道改选 OpenAI Chat Completions(自定义地址)即可,Proma 侧无需改动 |
