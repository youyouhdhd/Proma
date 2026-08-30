#!/usr/bin/env bun
/**
 * 为当前 Electron 运行时准备 node-pty。
 *
 * Windows 优先验证 node-pty 官方 N-API 预编译产物；只有预编译缺失、验证失败
 * 或显式传入 --force-rebuild 时才执行源码重编译。macOS/Linux 维持既有重编译流程。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

export type NodePtyPreparationMode = 'use-prebuild' | 'rebuild'

export interface NodePtyPreparationInput {
  platform: NodeJS.Platform
  forceRebuild: boolean
  hasPrebuild: boolean
  prebuildValidated: boolean
}

export function resolveNodePtyPreparationMode(input: NodePtyPreparationInput): NodePtyPreparationMode {
  if (input.forceRebuild || input.platform !== 'win32') return 'rebuild'
  return input.hasPrebuild && input.prebuildValidated ? 'use-prebuild' : 'rebuild'
}

const appDir = resolve(import.meta.dir, '..')
const nodePtyDir = join(appDir, 'node_modules', 'node-pty')
const prebuildDir = join(nodePtyDir, 'prebuilds', `${process.platform}-${process.arch}`)
const requiredWindowsPrebuildFiles = [
  'conpty.node',
  'conpty_console_list.node',
  'pty.node',
  'winpty-agent.exe',
  'winpty.dll',
]

function hasWindowsPrebuild(): boolean {
  return requiredWindowsPrebuildFiles.every((file) => existsSync(join(prebuildDir, file)))
}

function resolveElectronBinary(): string {
  const electronModulePath = createRequire(import.meta.url).resolve('electron')
  const electronRoot = dirname(electronModulePath)
  const executable = process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron'
  return join(electronRoot, 'dist', executable)
}

function validateWindowsPrebuild(): boolean {
  if (!hasWindowsPrebuild()) return false

  const marker = 'PROMA_NODE_PTY_PREBUILD_OK'
  const smokeScript = [
    `const nodePty = require(${JSON.stringify(nodePtyDir)});`,
    `const terminal = nodePty.spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'echo ${marker}'], {`,
    "  name: 'xterm-color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env,",
    '});',
    "let output = '';",
    'const timer = setTimeout(() => process.exit(2), 10000);',
    'terminal.onData((data) => { output += data; });',
    'terminal.onExit((event) => {',
    '  clearTimeout(timer);',
    `  process.exit(event.exitCode === 0 && output.includes('${marker}') ? 0 : 3);`,
    '});',
  ].join('\n')

  const result = spawnSync(resolveElectronBinary(), ['-e', smokeScript], {
    cwd: appDir,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true,
  })
  if (result.status === 0) return true

  console.warn('[node-pty] Windows 预编译产物验证失败，将尝试源码重编译。')
  if (result.stdout?.trim()) console.warn(result.stdout.trim())
  if (result.stderr?.trim()) console.warn(result.stderr.trim())
  return false
}

function runBun(args: string[]): void {
  const result = spawnSync(process.execPath, args, {
    cwd: appDir,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`命令执行失败：bun ${args.join(' ')}（exit ${result.status ?? 'unknown'}）`)
  }
}

function rebuildFromSource(): void {
  console.log('[node-pty] 针对当前 Electron 执行源码重编译。')
  try {
    runBun(['x', 'electron-rebuild', '-f', '-w', 'node-pty'])
    runBun(['run', 'ensure:node-pty-helper'])
  } catch (error) {
    if (process.platform === 'win32') {
      console.error('[node-pty] Windows 源码重编译需要 Visual Studio 的 C++ Spectre 缓解库。')
      console.error('[node-pty] 组件 ID：Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre')
    }
    throw error
  }
}

function main(): void {
  const forceRebuild = process.argv.includes('--force-rebuild')
  const hasPrebuild = process.platform === 'win32' && hasWindowsPrebuild()
  const prebuildValidated = hasPrebuild && !forceRebuild && validateWindowsPrebuild()
  const mode = resolveNodePtyPreparationMode({
    platform: process.platform,
    forceRebuild,
    hasPrebuild,
    prebuildValidated,
  })

  if (mode === 'use-prebuild') {
    console.log(`[node-pty] 已验证 Electron 可加载 ${process.platform}-${process.arch} N-API 预编译产物，跳过源码重编译。`)
    return
  }
  rebuildFromSource()
}

if (import.meta.main) main()
