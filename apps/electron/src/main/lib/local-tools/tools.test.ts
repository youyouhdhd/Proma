import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDefaultLocalToolRegistry } from './registry.ts'

let root = ''
const registry = createDefaultLocalToolRegistry()
const ctx = () => ({ workspaceId: 'ws-test', rootPath: root })

describe('本地工具（registry 执行）', () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'proma-tools-'))
    writeFileSync(join(root, 'package.json'), '{"name":"demo"}')
    writeFileSync(join(root, 'app.ts'), 'const a = 1\nconst b = 2\nconst c = 3')
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'util.ts'), 'export const util = () => search_text 有用')
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('workspace_info 返回工作区描述', async () => {
    const result = await registry.execute('workspace_info', {}, ctx())
    expect(result.ok).toBe(true)
    expect(result.data?.workspaceId).toBe('ws-test')
  })

  it('read_file 支持行范围与总行数', async () => {
    const result = await registry.execute('read_file', { path: 'app.ts', startLine: 2, endLine: 3 }, ctx())
    expect(result.ok).toBe(true)
    expect(result.data?.content).toBe('const b = 2\nconst c = 3')
    expect(result.data?.totalLines).toBe(3)
  })

  it('edit_file 仅在 oldText 唯一匹配时替换', async () => {
    const ok = await registry.execute('edit_file', { path: 'app.ts', oldText: 'const a = 1', newText: 'const a = 0' }, ctx())
    expect(ok.ok).toBe(true)
    const dup = await registry.execute('edit_file', { path: 'app.ts', oldText: 'const ', newText: 'x' }, ctx())
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error?.code).toBe('MATCH_NOT_UNIQUE')
  })

  it('search_text 命中并返回相对路径与行号', async () => {
    const result = await registry.execute('search_text', { query: 'SEARCH_TEXT 有用' }, ctx())
    expect(result.ok).toBe(true)
    expect(result.data?.count).toBeGreaterThan(0)
  })

  it('list_files 忽略 node_modules', async () => {
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
    const result = await registry.execute('list_files', { depth: 3 }, ctx())
    const entries = (result.data?.entries ?? []) as Array<{ path: string }>
    expect(entries.some((e) => e.path.includes('node_modules'))).toBe(false)
    expect(entries.some((e) => e.path === 'src/util.ts')).toBe(true)
  })

  it('未知工具返回 INVALID_INPUT', async () => {
    const result = await registry.execute('nope', {}, ctx())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error?.code).toBe('INVALID_INPUT')
  })
})
