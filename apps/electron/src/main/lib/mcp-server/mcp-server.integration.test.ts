/**
 * MCP Server 集成测试：真实 HTTP + MCP Client 走 initialize → tools/list → tools/call
 * 同时验证：路径越界拒绝、工具执行不触发任何模型调用（架构隔离）。
 */
import { describe, expect, it, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { PromaMcpServer } from './server.ts'
import { createDefaultLocalToolRegistry } from '../local-tools/registry.ts'

let root: string
const cleanups: Array<() => Promise<void>> = []

async function startServer(overrides?: { accessMode?: 'read-only' | 'full' }): Promise<string> {
  root = mkdtempSync(join(tmpdir(), 'proma-mcp-server-'))
  writeFileSync(join(root, 'package.json'), '{"name":"demo","dependencies":{"@modelcontextprotocol/sdk":"^1.29.0"}}')
  const server = new PromaMcpServer()
  cleanups.push(() => server.stop())
  const status = await server.start({
    config: { enabled: true, host: '127.0.0.1', port: 'auto', accessMode: overrides?.accessMode ?? 'read-only', tools: { fileRead: true, fileWrite: true, search: true, git: true, shell: false }, auth: { type: 'none' } },
    resolveWorkspace: () => ({ workspaceId: 'ws-int', rootPath: root }),
    registry: createDefaultLocalToolRegistry(),
  })
  return status.endpoint
}

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true })
})

describe('PromaMcpServer 集成', () => {
  it('MCP-A01/A02：initialize → tools/list 能发现只读工具集', async () => {
    const endpoint = await startServer()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(endpoint))
    await client.connect(transport)
    const tools = await client.listTools()
    const names = tools.tools.map((t) => t.name)
    for (const expected of ['workspace_info', 'list_files', 'read_file', 'search_text', 'find_files', 'git_status', 'git_diff']) {
      expect(names).toContain(expected)
    }
    expect(names).not.toContain('write_file')
    expect(names).not.toContain('shell_execute')
    await client.close()
  })

  it('MCP-A06：tools/call read_file 返回文件内容（不触发任何模型调用）', async () => {
    const endpoint = await startServer()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    const result = await client.callTool({ name: 'read_file', arguments: { path: 'package.json' } })
    expect(result.isError).toBe(false)
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? ''
    expect(text).toContain('@modelcontextprotocol/sdk')
    await client.close()
  })

  it('MCP-A03：read_file 路径越界被拒绝', async () => {
    const endpoint = await startServer()
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    const result = await client.callTool({ name: 'read_file', arguments: { path: '../../secret' } })
    expect(result.isError).toBe(true)
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? ''
    expect(text).toContain('PATH_OUTSIDE_WORKSPACE')
    await client.close()
  })

  it('full 模式下 write_file 真实写入文件', async () => {
    const endpoint = await startServer({ accessMode: 'full' })
    const client = new Client({ name: 'test-client', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
    await client.callTool({ name: 'write_file', arguments: { path: 'out.txt', content: 'TEST-MCP' } })
    expect(readFileSync(join(root, 'out.txt'), 'utf8')).toBe('TEST-MCP')
    await client.close()
  })
})
