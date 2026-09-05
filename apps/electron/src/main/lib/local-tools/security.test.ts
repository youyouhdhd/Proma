import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { guardWorkspacePath } from './security.ts'

let root = ''
const outsideFile = join(tmpdir(), 'proma-mcp-guard-secret.txt')

describe("guardWorkspacePath 安全守卫", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'proma-mcp-'))
    writeFileSync(join(root, 'a.txt'), 'hello')
    writeFileSync(outsideFile, 'secret')
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    if (existsSync(outsideFile)) rmSync(outsideFile, { force: true })
  })

  it('Given 工作区内相对路径 When 守卫 Then 返回存在的真实路径', () => {
    const result = guardWorkspacePath(root, 'a.txt', { mustExist: true })
    expect('error' in result).toBe(false)
    if (!('error' in result)) expect(result.path).toBe(resolve(root, 'a.txt'))
  })

  it('Given ../ 逃逸路径 When 守卫 Then 拒绝 PATH_OUTSIDE_WORKSPACE', () => {
    const result = guardWorkspacePath(root, '../../secret')
    if (!('error' in result)) throw new Error('应当拒绝')
    expect(result.error.code).toBe('PATH_OUTSIDE_WORKSPACE')
  })

  it('Given 绝对路径指向工作区外 When 守卫 Then 拒绝', () => {
    const result = guardWorkspacePath(root, resolve(tmpdir(), 'elsewhere.txt'))
    if (!('error' in result)) throw new Error('应当拒绝')
    expect(result.error.code).toBe('PATH_OUTSIDE_WORKSPACE')
  })

  it('Given workspace 内 symlink 指向外部文件 When 守卫 Then 拒绝 symlink 逃逸', () => {
    const link = join(root, 'escape.link')
    symlinkSync(outsideFile, link, 'file')
    const result = guardWorkspacePath(root, 'escape.link', { mustExist: true })
    if (!('error' in result)) throw new Error('应当拒绝 symlink 逃逸')
    expect(result.error.code).toBe('PATH_OUTSIDE_WORKSPACE')
  })

  it('Given workspace 内 symlink 目录指向外部目录 When 写入其中的新文件 Then 拒绝', () => {
    const outsideDir = join(tmpdir(), 'proma-mcp-outside-' + Date.now())
    mkdirSync(outsideDir)
    const link = join(root, 'escape.dir')
    symlinkSync(outsideDir, link, 'dir')
    const result = guardWorkspacePath(root, 'escape.dir/new.txt')
    if (!('error' in result)) throw new Error('应当拒绝')
    expect(result.error.code).toBe('PATH_OUTSIDE_WORKSPACE')
    rmSync(outsideDir, { recursive: true, force: true })
  })

  it('Given 待写入的新文件（父目录存在）When 守卫 Then 返回逻辑路径且不报错', () => {
    const result = guardWorkspacePath(root, 'new-dir/new.txt')
    if ('error' in result) throw new Error(result.error.message)
    expect(result.path).toBe(resolve(root, 'new-dir', 'new.txt'))
  })
})
