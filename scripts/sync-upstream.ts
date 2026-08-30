#!/usr/bin/env bun
/**
 * 安全同步官方上游的辅助命令。
 *
 * 默认只检查，不切换分支、不创建提交。传入 --apply 后会从当前 main
 * 创建备份和同步分支，并把 upstream/main 增量合入同步分支；冲突会停在
 * 同步分支等待人工处理，脚本不会自动推送 main。
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

export interface RevListCounts {
  left: number
  right: number
}

export type SyncCommand = 'noop' | 'report' | 'apply'

export interface SyncBranchNames {
  backup: string
  sync: string
}

interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}

interface SyncOptions {
  apply: boolean
  verify: boolean
}

const repoRoot = resolve(import.meta.dir, '..')

export function parseRevListCounts(raw: string): RevListCounts {
  const values = raw.trim().split(/\s+/).map(Number)
  const left = values[0]
  const right = values[1]
  if (!Number.isInteger(left) || !Number.isInteger(right) || left < 0 || right < 0) {
    throw new Error(`无法解析 Git 提交计数：${raw.trim()}`)
  }
  return { left, right }
}

export function formatSyncTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export function createSyncBranchNames(timestamp: string): SyncBranchNames {
  return {
    backup: `backup/main-before-upstream-${timestamp}`,
    sync: `sync/upstream-${timestamp}`,
  }
}

export function resolveSyncCommand(apply: boolean, upstreamAhead: number): SyncCommand {
  if (!apply) return upstreamAhead > 0 ? 'report' : 'noop'
  return 'apply'
}

function execute(command: string, args: string[], capture = false): CommandResult {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    windowsHide: true,
  })
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : result.stdout?.toString() ?? '',
    stderr: typeof result.stderr === 'string' ? result.stderr : result.stderr?.toString() ?? '',
    error: result.error,
  }
}

function runGit(args: string[], capture = false): CommandResult {
  const result = execute('git', args, capture)
  if (result.status !== 0) {
    const detail = [result.error?.message, result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n')
    throw new Error(`git ${args.join(' ')} 执行失败（exit ${result.status ?? 'unknown'}）${detail ? `\n${detail}` : ''}`)
  }
  return result
}

function runBun(args: string[]): boolean {
  const result = execute(process.execPath, args)
  return result.status === 0
}

function branchExists(branch: string): boolean {
  return execute('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).status === 0
}

function parseOptions(): SyncOptions {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const verify = args.includes('--verify')
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
上游同步助手

用法：
  bun run sync:upstream                 只检查 upstream/main 是否有更新
  bun run sync:upstream --apply         创建备份/同步分支并增量合并上游
  bun run sync:upstream --apply --verify 合并后运行 typecheck、test 和 Electron build

安全约束：
  - 要求当前分支是 main 且工作区干净
  - 冲突停在同步分支，不自动解决
  - 不自动合并回 main，不自动 push
`)
    process.exit(0)
  }
  const unknown = args.filter((arg) => !['--apply', '--verify'].includes(arg))
  if (unknown.length > 0) throw new Error(`未知参数：${unknown.join(', ')}`)
  if (verify && !apply) throw new Error('--verify 必须与 --apply 一起使用')
  return { apply, verify }
}

function ensureMainAndClean(): void {
  const branch = runGit(['branch', '--show-current'], true).stdout.trim()
  if (branch !== 'main') throw new Error(`当前分支是 ${branch || 'detached HEAD'}，请先切换到 main`)
  const status = runGit(['status', '--porcelain'], true).stdout.trim()
  if (status) throw new Error('工作区不是干净状态，请先提交或保存当前修改后再同步')
}

function fetchRemotes(): void {
  runGit(['remote', 'get-url', 'upstream'], true)
  runGit(['fetch', 'origin', 'main', '--prune'])
  runGit(['fetch', 'upstream', 'main', '--prune'])
}

function ensureOriginIsNotAhead(): void {
  const counts = parseRevListCounts(runGit(['rev-list', '--left-right', '--count', 'origin/main...main'], true).stdout)
  if (counts.left > 0) {
    throw new Error(`origin/main 比本地 main 多 ${counts.left} 个提交，请先执行 git pull --ff-only origin main`)
  }
}

function printUpstreamSummary(): number {
  const counts = parseRevListCounts(runGit(['rev-list', '--left-right', '--count', 'upstream/main...main'], true).stdout)
  console.log(`上游独有提交：${counts.left} 个；本 Fork 独有提交：${counts.right} 个`)
  if (counts.left > 0) {
    console.log('\n上游待合并提交：')
    runGit(['log', '--oneline', '--decorate', 'main..upstream/main'])
  }
  return counts.left
}

function applyUpstream(verify: boolean, upstreamAhead: number): void {
  if (upstreamAhead === 0) {
    console.log('upstream/main 没有新提交，无需同步。')
    return
  }

  const names = createSyncBranchNames(formatSyncTimestamp(new Date()))
  if (branchExists(names.backup) || branchExists(names.sync)) {
    throw new Error(`同步分支已存在：${names.backup} 或 ${names.sync}，请检查后重试`)
  }

  runGit(['branch', names.backup, 'main'])
  runGit(['switch', '-c', names.sync, 'main'])
  const merge = execute('git', ['merge', '--no-ff', '--no-edit', 'upstream/main'])
  if (merge.status !== 0) {
    console.error(`\n上游合并发生冲突，当前停留在同步分支：${names.sync}`)
    console.error('解决后执行 git add <文件> && git commit，或执行 git merge --abort 放弃本次合并。')
    process.exitCode = 2
    return
  }

  if (verify) {
    console.log('\n开始运行同步验证：typecheck、test、electron:build')
    if (!runBun(['run', 'typecheck']) || !runBun(['test']) || !runBun(['run', 'electron:build'])) {
      console.error(`\n验证失败，保留同步分支供排查：${names.sync}`)
      process.exitCode = 3
      return
    }
  }

  console.log(`\n同步分支已准备完成：${names.sync}`)
  console.log(`备份分支：${names.backup}`)
  console.log('\n验证通过后再执行：')
  console.log(`  git switch main`)
  console.log(`  git merge --ff-only ${names.sync}`)
  console.log('  git push origin main')
}

function main(): void {
  try {
    const options = parseOptions()
    ensureMainAndClean()
    fetchRemotes()
    ensureOriginIsNotAhead()
    const upstreamAhead = printUpstreamSummary()
    if (resolveSyncCommand(options.apply, upstreamAhead) !== 'apply') return
    applyUpstream(options.verify, upstreamAhead)
  } catch (error) {
    console.error(`[sync:upstream] ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}

if (import.meta.main) main()
