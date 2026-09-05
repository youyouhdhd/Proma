/**
 * PROMA MCP Server（供 ChatGPT Web 等外部 MCP Client 调用）
 *
 * 定位：本地能力服务器（文件/搜索/Git/Shell），不是 PROMA Agent 的远程包装。
 * 工具执行期间绝不触发 Pi / Codex / 任何模型调用。
 */

// ===== 工具 ID =====

/** MCP Server 暴露的工具标识（与 LocalToolRegistry 注册名一致） */
export type PromaMcpToolId =
  | 'workspace_info'
  | 'list_files'
  | 'read_file'
  | 'search_text'
  | 'find_files'
  | 'git_status'
  | 'git_diff'
  | 'write_file'
  | 'edit_file'
  | 'shell_execute'

// ===== 配置 =====

/** MCP Server 认证方式 */
export type PromaMcpAuthType = 'none' | 'bearer'

/** MCP Server 各工具组开关 */
export interface PromaMcpServerToolToggles {
  /** 文件读取类（read_file / list_files / find_files） */
  fileRead: boolean
  /** 文件写入类（write_file / edit_file） */
  fileWrite: boolean
  /** 文本搜索（search_text） */
  search: boolean
  /** Git 只读（git_status / git_diff） */
  git: boolean
  /** Shell 执行（高风险，默认关闭） */
  shell: boolean
}

/** MCP Server 配置（持久化到 settings.json 的 mcpServer 字段） */
export interface PromaMcpServerConfig {
  enabled: boolean
  host: '127.0.0.1'
  /** 固定端口或自动选择 */
  port: number | 'auto'
  /** MCP Server 绑定的 Proma 工作区 */
  workspaceId?: string
  /** 访问模式：read-only（第一阶段默认）/ full */
  accessMode: 'read-only' | 'full'
  tools: PromaMcpServerToolToggles
  auth: {
    type: PromaMcpAuthType
    token?: string
  }
}

// ===== 状态 =====

/** MCP Server 运行状态 */
export interface PromaMcpServerStatus {
  running: boolean
  host: string
  port: number
  /** 完整 endpoint，如 http://127.0.0.1:8787/mcp */
  endpoint: string
  activeSessions: number
  workspaceId?: string
  /** 最近一次错误（启动失败等） */
  errorMessage?: string
}

/** 工具摘要（设置页展示） */
export interface PromaMcpToolSummary {
  name: PromaMcpToolId | string
  description: string
  risk: 'read' | 'write' | 'execute'
  /** 是否在当前配置下启用 */
  enabled: boolean
}

// ===== IPC 通道 =====

export const MCP_SERVER_IPC_CHANNELS = {
  GET_STATUS: 'mcp-server:get-status',
  START: 'mcp-server:start',
  STOP: 'mcp-server:stop',
  UPDATE_CONFIG: 'mcp-server:update-config',
  LIST_TOOLS: 'mcp-server:list-tools',
} as const
