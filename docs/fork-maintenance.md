# Proma Fork 维护与上游同步指南

记录版本：0.1.4
最后核对：2026-08-30
适用对象：维护 `youyouhdhd/Proma` Fork 的开发者

本文的目标是让维护者在 `proma-ai/Proma` 发布新版本后，能够先取得上游更新，再有边界地重放本 Fork 的定制功能。它记录当前仓库的真实分叉状态、定制提交和已知冲突区域；不把上游代码复制成第二份，也不建议直接在 `main` 上试错。

## 当前仓库状态

### 远端关系

| 名称 | 地址 | 用途 |
| --- | --- | --- |
| `origin` | `https://github.com/youyouhdhd/Proma.git` | 本 Fork，提交和发布目标 |
| `upstream` | `https://github.com/proma-ai/Proma.git` | 官方上游，只用于获取最新代码 |

本机已经配置了 `upstream` 远端。新克隆的副本需要手动执行：

~~~powershell
git remote add upstream https://github.com/proma-ai/Proma.git
git fetch upstream --prune
~~~

### 2026-08-29 合并前快照

- 本 Fork 的 v0.18.3 发布基线：`57e18e30`，tag `v0.18.3`，应用版本 `0.18.3`。
- 上游 `upstream/main`：`c261cbc5`，应用版本 `0.19.5`。
- `main` 与上游的共同基点：`92a635fa`（官方 v0.18.2）。
- 在这个 v0.18.3 比较快照中，相对共同基点上游新增 73 个提交，本 Fork 发布基线新增 1 个提交（本地构建指南、版本元数据和 Windows 测试修正）。本维护文档本身不属于上游产品定制差异。
- 本 Fork 的主要产品定制当时位于独立分支 `origin/feat/custom-model-reasoning`，提交为 `0a19e264`，尚未合并进 `main`。

该快照说明 Fork 不会自动获得上游功能，但可以在同步分支中合并 `upstream/main`，再重放定制提交。

### 2026-08-30 同步结果

- 已将上游 `c261cbc5`（官方 v0.19.5）合入同步分支，合并提交为 `d8dd43ed`。
- 合并前备份分支：`backup/main-before-upstream-v0.19.5-20260830`。
- 同步分支：`sync/upstream-v0.19.5-20260830`。
- 自建模型推理档位以 `0a19e264` 为行为规格适配到上游新架构，没有覆盖上游 Pi 0.84.4、reasoning profiles、终端、Vault、LiveMarkdown 和新版工作区布局。
- 集成版本：应用 `0.19.6`、shared `0.1.67`、core `0.2.18`、根项目 `0.1.3`。
- 定制适配继续覆盖 Chat 与 Agent 双路径、频道配置 UI、多窗口频道同步及 BDD 测试。
- Windows 打包在应用 `0.19.7` / 根项目 `0.1.4` 增加了 node-pty 预编译 Electron 冒烟验证；保留 Spectre 源码重编译，不再通过修改 gyp 降低安全选项。

### 2026-08-30 上游同步自动化

- 根项目 `0.1.5` 增加 `sync:upstream` 和 `verify:upstream` 入口。
- `sync:upstream` 默认只检查；`--apply` 会检查工作区、抓取 origin/upstream、创建备份分支和同步分支，再增量合并上游。
- `--apply --verify` 在无冲突合并后自动执行类型检查、全量测试和 Electron 构建；冲突或验证失败都会保留同步分支，不自动推送。
- 当前 `main` 已经包含定制实现，未来从 `main` 合并上游时不需要重复 cherry-pick `0a19e264`；该提交仅作为从零恢复定制的历史规格。

## 本 Fork 的定制记录

### 定制提交：自建模型推理档位

提交：`0a19e2643afbcca9eb34b0c052c8ab09b68a8362`
父提交：`c63fb3e6166b4a6b2796688f920c719dcd4fb0a9`
提交时间：2026-08-26 20:57（UTC+8）
提交说明：`feat(reasoning): 支持自建 OpenAI 兼容模型配置推理档位 / support custom reasoning levels for self-hosted models`

变更规模：31 个文件，新增 934 行，删除 54 行。

行为边界：

- 在 shared 类型层增加频道模型的推理档位、默认值和 thinking 映射。
- 在 OpenAI Chat Completions / Responses 适配器中传递 `reasoning_effort`。
- 对 Agent 与 Chat 暴露自建模型的推理档位选择，并保持内置模型 profile 优先。
- 通过 IPC、preload 和 renderer 状态把频道级能力传到 Pi runtime。
- 同批次增加渠道配置跨窗口广播，保证多个窗口看到同一份渠道列表。
- 配套增加 shared、core、main 和 renderer 的 BDD 风格测试。

完整变更可以随时从 Git 恢复或查看：

~~~powershell
git show --stat 0a19e264
git show 0a19e264 -- apps/electron packages
~~~

定制提交涉及的主要区域：

| 区域 | 文件/职责 |
| --- | --- |
| Shared 契约 | `packages/shared/src/types/reasoning-profile.ts`、`channel.ts`、`chat.ts` 及其测试 |
| Provider 适配 | `packages/core/src/providers/openai-adapter.ts`、`openai-responses-adapter.ts`、`types.ts` 及测试 |
| Pi 能力注册 | `apps/electron/src/main/lib/adapters/pi-model-registry.ts`、`pi-agent-adapter.ts` 及测试 |
| Agent / Chat 主进程 | `agent-orchestrator.ts`、`chat-service.ts`、`ipc.ts` |
| IPC 边界 | `apps/electron/src/preload/index.ts` |
| UI 与会话状态 | `AgentView.tsx`、`ChatInput.tsx`、`ChatView.tsx`、`ChannelForm.tsx`、`chat-atoms.ts`、`useConversationSettings.ts`、`channel-model-reasoning.ts` |
| 版本与锁文件 | `apps/electron/package.json`、`packages/core/package.json`、`packages/shared/package.json`、`bun.lock` |

### 本次维护提交：v0.18.3 构建记录

提交：`57e18e308e5d214fffbb935c68ac3911dc11412c`
提交说明：`chore: prepare Proma v0.18.3 release`

该提交包含构建指南、README 版本修正、Windows 测试隔离修正和版本元数据更新。它不是上游产品定制功能；同步上游时应保留文档和测试修正，但应用版本号以待发布的上游/本地版本策略为准，不要把 `0.18.3` 强行覆盖上游的新版本。

## 上游更新后的推荐流程

### 自动流程（推荐）

先在本地只检查上游：

~~~powershell
git switch main
git config rerere.enabled true
bun run sync:upstream
~~~

确认待合并提交后执行：

~~~powershell
bun run sync:upstream --apply --verify
~~~

脚本会自动创建类似下面的分支，并在成功后停留在同步分支：

~~~text
backup/main-before-upstream-20260830-123456
sync/upstream-20260830-123456
~~~

如果没有冲突且验证通过，按脚本输出快进并推送：

~~~powershell
git switch main
git merge --ff-only sync/upstream-<时间戳>
git push origin main
~~~

如果出现冲突，脚本会停在同步分支；解决后执行：

~~~powershell
git add <已解决的文件>
git commit -m "chore: resolve upstream sync"
bun run verify:upstream
~~~

验证失败时保留同步分支排查，不要把未验证的合并结果快进到 `main`。脚本从不自动修改 `main` 或推送远端。

### 1. 先保存当前状态并获取上游

~~~powershell
git status --short --branch
git switch main
git pull --ff-only origin main
git fetch upstream --prune
git rev-list --left-right --count upstream/main...main
git log --oneline --decorate main..upstream/main
~~~

如果工作区不是干净状态，先提交当前工作，或明确保存为临时 stash。不要带着未记录的改动开始同步。

### 2. 建立同步分支和备份点

~~~powershell
$stamp = Get-Date -Format yyyyMMdd-HHmmss
git branch "backup/main-before-upstream-$stamp"
git switch -c "sync/upstream-$stamp" main
git merge --no-commit upstream/main
~~~

同步分支用于处理冲突和验证。`main` 在验证完成前保持不动；如果合并过程需要放弃：

~~~powershell
git merge --abort
~~~

### 3. 先处理上游合并，再按需重放定制提交

确认上游合并内容后提交合并结果，或者在合并提交状态下继续执行：

~~~powershell
git status
git add <已解决的文件>
git commit -m "chore: merge upstream main"
~~~

当前 `main` 已包含适配后的定制实现，日常同步不要再执行 `git cherry-pick 0a19e264`。只有在从 `upstream/main` 或其他干净基线重新建立一个没有定制的 Fork 时，才使用该历史提交作为重放入口：

~~~powershell
git cherry-pick 0a19e264
~~~

也可以直接从旧定制分支创建一个独立重放分支（仅用于灾备/从零恢复）：

~~~powershell
git switch -c "sync/custom-reasoning-$stamp" origin/feat/custom-model-reasoning
git rebase upstream/main
~~~

日常同步优先使用自动流程；手动流程只用于脚本无法处理的冲突或从零恢复。当前主分支已经把上游和定制提交串在同一条历史中，Git 的三方合并会自动携带非冲突定制。

### 4. 冲突处理原则

定制提交与上游有 17 个文件重叠，预计最需要人工复核的是：

~~~text
apps/electron/package.json
apps/electron/src/main/ipc.ts
apps/electron/src/main/lib/adapters/pi-agent-adapter.ts
apps/electron/src/main/lib/adapters/pi-model-registry.ts
apps/electron/src/main/lib/agent-orchestrator.ts
apps/electron/src/main/lib/chat-service.ts
apps/electron/src/preload/index.ts
apps/electron/src/renderer/atoms/chat-atoms.ts
apps/electron/src/renderer/components/agent/AgentView.tsx
apps/electron/src/renderer/components/app-shell/LeftSidebar.tsx
apps/electron/src/renderer/components/chat/ChatInput.tsx
apps/electron/src/renderer/components/chat/ChatView.tsx
apps/electron/src/renderer/components/settings/ChannelForm.tsx
apps/electron/src/renderer/main.tsx
bun.lock
packages/shared/package.json
packages/shared/src/types/reasoning-profile.ts
~~~

处理顺序：

1. 保留上游最新的 Pi runtime、Electron 和依赖版本；不要把定制提交中的旧版本号直接带回去。
2. 以当前上游的 shared 类型为基线，把频道级 reasoning 字段重新接入，并检查导出入口。
3. 以当前上游的 provider / Pi registry 为基线，重新应用“内置 profile 优先、频道声明 fallback”的行为。
4. 再恢复 IPC、preload、Agent/Chat UI 和会话状态，避免只修 UI 而丢掉线上参数透传。
5. 重新检查新增测试，必要时把测试断言改为上游当前接口，而不是删除测试。

查看冲突和定制原始补丁：

~~~powershell
git status
git diff --name-only --diff-filter=U
git show 0a19e264 -- apps/electron/src/main/lib/adapters/pi-model-registry.ts packages/shared/src/types/reasoning-profile.ts
~~~

如果确认无法继续重放：

~~~powershell
git cherry-pick --abort
~~~

不要用 `git reset --hard` 覆盖工作区；先保留同步分支和备份分支，方便重新比较。

### 5. 验证并合并回 main

~~~powershell
bun run verify:upstream
git diff --check
git diff --stat upstream/main...HEAD
git log --oneline --decorate upstream/main..HEAD
~~~

Windows 桌面构建：

~~~powershell
bun run --filter='@proma/electron' dist:win
~~~

如果本机缺少 Visual Studio Spectre 库，`prepare:node-pty` 会优先验证官方预编译 N-API 产物；需要源码重编译时再按 [构建指南](./build.md) 补齐 native 工具链。确认安装包、CLI 和 `node-pty` 均通过后，再合并同步分支：

~~~powershell
git switch main
git merge --ff-only sync/upstream-<时间戳>
git push origin main
~~~

如果应用行为或安装包版本发生变化，更新 `apps/electron/package.json`、对应锁文件和发布记录；仅文档/维护记录变更也要递增对应项目版本号。

## 快速判断是否需要同步

每次开始工作前可以执行：

~~~powershell
git fetch upstream --prune
git rev-list --left-right --count upstream/main...main
git log --oneline --decorate main..upstream/main
~~~

输出的两个数字分别是“上游独有提交数”和“本 Fork 独有提交数”。只要第一个数字大于 0，就说明上游有新内容；先在同步分支中评估，不要直接把 `upstream/main` 拉进生产分支。

若要确认定制提交仍可独立重放：

~~~powershell
git show-ref --verify refs/remotes/origin/feat/custom-model-reasoning
git merge-base --is-ancestor 0a19e264 origin/feat/custom-model-reasoning
git show --stat 0a19e264
~~~

## 维护约定

- 上游只通过 `upstream` 获取，不直接把 Fork 的 `origin` 当成上游。
- 每个本地功能保持为独立、可 cherry-pick 的提交；不要把上游合并提交和定制实现混成一个无法识别的大提交。
- 日常更新使用 `sync:upstream` 创建一次性同步分支；不要在 `main` 上直接试错，也不要每次重复 cherry-pick 已经进入 `main` 的提交。
- 定制功能涉及多个 IPC 层时，继续同时维护 shared、main、preload、renderer 和测试。
- 每次成功同步后，更新本文的快照提交、应用版本、共同基点和冲突清单。
- 发布前保留 `git diff upstream/main...HEAD` 和 `git range-diff` 的审查记录，确认没有误覆盖上游改动。

## 相关文件

- [构建指南](./build.md)
- [根目录 AGENTS.md](../AGENTS.md)
- [GitHub Actions 发布工作流](../.github/workflows/release.yml)
