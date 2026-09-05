/**
 * MCP Server 服务单例：
 * - 从应用设置读取配置并启动/停止；
 * - 解析 MCP Server 绑定的 Proma 工作区（projectRootPath 或托管项目目录）；
 * - 对 IPC 暴露状态/启动/停止/更新配置/工具列表。
 */

import { existsSync } from 'node:fs'
import type { PromaMcpServerConfig, PromaMcpServerStatus, PromaMcpToolSummary } from '@proma/shared'
import { getSettings } from '../settings-service'
import { getAgentWorkspace, getProjectFilesPath } from '../agent-workspace-manager'
import { normalizePromaMcpServerConfig } from './config'
import { createDefaultLocalToolRegistry, selectVisibleTools } from './index'
import { PromaMcpServer } from './server'

const registry = createDefaultLocalToolRegistry()

function resolveWorkspaceFromSettings(config: PromaMcpServerConfig): { workspaceId: string; rootPath: string } {
  const workspaceId = config.workspaceId ?? ''
  const workspace = workspaceId ? getAgentWorkspace(workspaceId) : undefined
  if (!workspace) {
    throw new Error('MCP Server 尚未绑定有效的 Proma 工作区，请先在设置中选择。')
  }
  const rootPath = workspace.projectRootPath ?? (workspace.slug ? getProjectFilesPath(workspace.slug) : '')
  if (!rootPath || !existsSync(rootPath)) {
    throw new Error(`MCP Server 工作区根目录不可用：${rootPath || '(未设置)'}`)
  }
  return { workspaceId: workspace.id, rootPath }
}

class PromaMcpServerService {
  private readonly server = new PromaMcpServer()

  /** 按当前设置启动（设置未启用或未绑定工作区时抛错） */
  async startFromSettings(): Promise<PromaMcpServerStatus> {
    const settings = getSettings()
    const config = normalizePromaMcpServerConfig(settings.mcpServer)
    return this.server.start({
      config,
      resolveWorkspace: () => resolveWorkspaceFromSettings(config),
      registry,
    })
  }

  async stop(): Promise<void> {
    await this.server.stop()
  }

  getStatus(): PromaMcpServerStatus {
    return this.server.getStatus()
  }

  /** 更新配置并按需启动/停止/重启 */
  async applyConfig(config: PromaMcpServerConfig): Promise<PromaMcpServerStatus> {
    const normalized = normalizePromaMcpServerConfig(config)
    const wasRunning = this.server.running
    if (wasRunning) await this.server.stop()
    if (normalized.enabled) {
      return this.server.start({
        config: normalized,
        resolveWorkspace: () => resolveWorkspaceFromSettings(normalized),
        registry,
      })
    }
    return this.getStatus()
  }

  listTools(): PromaMcpToolSummary[] {
    const settings = getSettings()
    const config = normalizePromaMcpServerConfig(settings.mcpServer)
    const visible = new Set(selectVisibleTools(config, registry).map((t) => t.name))
    return registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      risk: tool.risk,
      enabled: visible.has(tool.name),
    }))
  }
}

export const promaMcpServerService = new PromaMcpServerService()
