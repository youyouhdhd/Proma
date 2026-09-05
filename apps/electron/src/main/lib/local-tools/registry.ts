/**
 * LocalToolRegistry — 本地工具注册表
 *
 * Pi Agent 与 MCP Server 共享的统一工具层。注册表只负责登记与执行，
 * 不感知任何传输层（MCP HTTP / Pi ToolDefinition）与安全策略过滤
 * （工具可见性过滤由 McpToolAdapter 按配置完成）。
 */

import type { LocalToolContext, LocalToolDefinition, LocalToolResult } from './types'
import { workspaceInfoTool } from './workspace-tool'
import { listFilesTool, readFileTool, writeFileTool, editFileTool } from './filesystem-tools'
import { searchTextTool, findFilesTool } from './search-tools'
import { gitStatusTool, gitDiffTool } from './git-tools'
import { shellExecuteTool } from './shell-tools'

export class LocalToolRegistry {
  private readonly tools = new Map<string, LocalToolDefinition>()

  register(definition: LocalToolDefinition): this {
    this.tools.set(definition.name, definition)
    return this
  }

  get(name: string): LocalToolDefinition | undefined {
    return this.tools.get(name)
  }

  list(): LocalToolDefinition[] {
    return [...this.tools.values()]
  }

  async execute(name: string, input: Record<string, unknown>, context: LocalToolContext): Promise<LocalToolResult> {
    const definition = this.tools.get(name)
    if (!definition) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: `未知工具: ${name}` } }
    }
    return definition.execute(input ?? {}, context)
  }
}

/** 创建内置全量注册表（MCP Server 使用；Pi 侧后续迁移共用） */
export function createDefaultLocalToolRegistry(): LocalToolRegistry {
  return new LocalToolRegistry()
    .register(workspaceInfoTool)
    .register(listFilesTool)
    .register(readFileTool)
    .register(searchTextTool)
    .register(findFilesTool)
    .register(gitStatusTool)
    .register(gitDiffTool)
    .register(writeFileTool)
    .register(editFileTool)
    .register(shellExecuteTool)
}
