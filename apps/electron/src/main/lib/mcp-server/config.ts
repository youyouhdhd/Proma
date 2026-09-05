/** MCP Server 配置规范化（settings.json 反序列化入口） */

import type { PromaMcpServerConfig } from '@proma/shared'

export const DEFAULT_PROMA_MCP_SERVER_CONFIG: PromaMcpServerConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 'auto',
  accessMode: 'read-only',
  tools: { fileRead: true, fileWrite: false, search: true, git: true, shell: false },
  auth: { type: 'none' },
}

/** 深度规范化：未知输入一律回退安全默认值（read-only、shell 关闭） */
export function normalizePromaMcpServerConfig(input: unknown): PromaMcpServerConfig {
  if (!input || typeof input !== 'object') return { ...DEFAULT_PROMA_MCP_SERVER_CONFIG }
  const raw = input as Partial<PromaMcpServerConfig>
  const tools = (raw.tools ?? {}) as Partial<PromaMcpServerConfig['tools']>
  const auth = (raw.auth ?? {}) as Partial<PromaMcpServerConfig['auth']>
  return {
    enabled: raw.enabled === true,
    host: '127.0.0.1',
    port: raw.port === 'auto' || (typeof raw.port === 'number' && raw.port > 0 && raw.port <= 65535) ? raw.port : 'auto',
    ...(typeof raw.workspaceId === 'string' && raw.workspaceId ? { workspaceId: raw.workspaceId } : {}),
    accessMode: raw.accessMode === 'full' ? 'full' : 'read-only',
    tools: {
      fileRead: tools.fileRead !== false,
      fileWrite: tools.fileWrite === true,
      search: tools.search !== false,
      git: tools.git !== false,
      shell: tools.shell === true,
    },
    auth: auth.type === 'bearer' && typeof auth.token === 'string' && auth.token.length > 0
      ? { type: 'bearer', token: auth.token }
      : { type: 'none' },
  }
}
