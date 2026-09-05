/**
 * PromaMcpServer — 面向 ChatGPT Web 等外部 MCP Client 的本地能力服务器
 *
 * - Streamable HTTP（POST /mcp 初始化与会话内调用；GET/DELETE 管理 SSE 与关闭）；
 * - 默认仅监听 127.0.0.1；
 * - 会话按 Mcp-Session-Id 管理，空闲 30 分钟回收，应用退出全部关闭；
 * - 工具经 McpToolAdapter 从 LocalToolRegistry 过滤暴露；
 * - 工具执行不触碰 Pi / Codex / 任何模型调用（架构隔离硬约束）。
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { normalizePromaMcpServerConfig } from './config'
import { selectVisibleTools } from './tool-adapter'
import { SessionManager } from './session-manager'
import { isRequestAuthorized } from './auth'
import type { PromaMcpServerConfig, PromaMcpServerStatus } from '@proma/shared'
import type { LocalToolRegistry, LocalToolContext } from '../local-tools'

const IDLE_TTL_MS = 30 * 60 * 1000

export interface PromaMcpServerWorkspace {
  workspaceId: string
  rootPath: string
}

interface StartInput {
  config: PromaMcpServerConfig
  /** 解析当前生效的 workspace（id + 绝对根路径）；无法解析时抛错 */
  resolveWorkspace(): PromaMcpServerWorkspace
  registry: LocalToolRegistry
}

export class PromaMcpServer {
  private httpServer: ReturnType<typeof createServer> | null = null
  private readonly sessions = new SessionManager()
  private config: PromaMcpServerConfig | null = null
  private workspace: PromaMcpServerWorkspace | null = null
  private registry: LocalToolRegistry | null = null
  private lastError: string | undefined

  get running(): boolean {
    return this.httpServer !== null
  }

  async start(input: StartInput): Promise<PromaMcpServerStatus> {
    await this.stop()
    const config = normalizePromaMcpServerConfig(input.config)
    const workspace = input.resolveWorkspace()
    this.config = config
    this.workspace = workspace
    this.registry = input.registry

    const host = config.host
    const requestedPort = config.port === 'auto' ? 0 : config.port

    const httpServer = createServer((req, res) => { void this.route(req, res) })
    this.httpServer = httpServer

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error): void => { this.httpServer = null; reject(err) }
      httpServer.once('error', onError)
      httpServer.listen(requestedPort, host, () => {
        httpServer.off('error', onError)
        resolve()
      })
    })

    const address = httpServer.address()
    const port = typeof address === 'object' && address ? address.port : requestedPort
    this.sessions.startIdleSweep((sessionId) => { void this.closeSession(sessionId) })
    return this.getStatus(port)
  }

  async stop(): Promise<void> {
    this.sessions.closeAll()
    const server = this.httpServer
    this.httpServer = null
    this.sessions.stopIdleSweep()
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  getStatus(portOverride?: number): PromaMcpServerStatus {
    const server = this.httpServer
    const address = server?.address()
    const port = portOverride ?? (typeof address === 'object' && address ? address.port : (this.config?.port === 'auto' ? 0 : this.config?.port ?? 0))
    return {
      running: server !== null,
      host: this.config?.host ?? '127.0.0.1',
      port,
      endpoint: server !== null ? `http://${this.config?.host ?? '127.0.0.1'}:${port}/mcp` : '',
      activeSessions: this.sessions.size,
      ...(this.workspace ? { workspaceId: this.workspace.workspaceId } : {}),
      ...(this.lastError ? { errorMessage: this.lastError } : {}),
    }
  }

  private async closeSession(sessionId: string): Promise<void> {
    const entry = this.sessions.get(sessionId)
    if (!entry) return
    this.sessions.delete(sessionId)
    try { await entry.transport.close() } catch { /* 已关闭 */ }
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? ''
    const config = this.config
    if (!config || !this.httpServer) {
      res.writeHead(503).end()
      return
    }

    if (url === '/health' || url.startsWith('/health?')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ name: 'Proma MCP', status: 'ok' }))
      return
    }

    if (!url.startsWith('/mcp')) {
      res.writeHead(404).end()
      return
    }

    if (!isRequestAuthorized(config.auth, req.headers.authorization)) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'unauthorized' }))
      return
    }

    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id']
      if (typeof sessionId === 'string') await this.closeSession(sessionId)
      res.writeHead(200).end()
      return
    }

    if (req.method !== 'POST' && req.method !== 'GET') {
      res.writeHead(405, { allow: 'POST, GET, DELETE' }).end()
      return
    }

    const sessionHeader = req.headers['mcp-session-id']
    const sessionId = typeof sessionHeader === 'string' ? sessionHeader : undefined

    if (req.method === 'POST' && !sessionId) {
      await this.handleInitialize(req, res)
      return
    }

    const entry = sessionId ? this.sessions.get(sessionId) : undefined
    if (!entry) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }))
      return
    }
    this.sessions.touch(sessionId!)
    const body = req.method === 'POST' ? await readJsonBody(req) : undefined
    await entry.transport.handleRequest(req, res, body)
  }

  /** 首次 POST（initialize）：为该客户端创建独立 transport + MCP Server 实例 */
  private async handleInitialize(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJsonBody(req)
    if (!this.registry || !this.config || !this.workspace) {
      res.writeHead(503).end()
      return
    }
    const registry = this.registry
    const config = this.config
    const workspace = this.workspace

    const server = new Server(
      { name: 'Proma MCP', version: '1.0.0' },
      { capabilities: { tools: {} } },
    )

    server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: selectVisibleTools(config, registry).map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    }))

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const name = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, unknown>
      const context: LocalToolContext = { workspaceId: workspace.workspaceId, rootPath: workspace.rootPath }
      const result = await registry.execute(name, args, context)
      const text = result.text ?? JSON.stringify(result.ok ? (result.data ?? {}) : (result.error ?? { ok: false }))
      return {
        content: [{ type: 'text', text }],
        ...(result.ok && result.data ? { structuredContent: result.data } : {}),
        isError: !result.ok,
      }
    })

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId: string) => {
        this.sessions.set(sessionId, { transport, server, createdAt: Date.now(), lastUsedAt: Date.now() })
      },
      onsessionclosed: (sessionId: string) => {
        this.sessions.delete(sessionId)
      },
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : undefined
}
