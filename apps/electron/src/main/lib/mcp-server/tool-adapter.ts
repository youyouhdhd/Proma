/**
 * McpToolAdapter — 按 Server 配置从 LocalToolRegistry 过滤可见工具
 *
 * - accessMode=read-only：仅 read 风险工具；
 * - accessMode=full：按工具组开关放行 write/execute；
 * - workspace_info 始终可见（工作区描述符，不含任何敏感能力）。
 */

import type { PromaMcpServerConfig } from '@proma/shared'
import type { LocalToolRegistry, LocalToolDefinition } from '../local-tools'

export function selectVisibleTools(config: PromaMcpServerConfig, registry: LocalToolRegistry): LocalToolDefinition[] {
  return registry.list().filter((tool) => {
    if (tool.name === 'workspace_info') return true
    if (tool.risk === 'read') {
      if (tool.name === 'search_text') return config.tools.search
      if (tool.name === 'git_status' || tool.name === 'git_diff') return config.tools.git
      return config.tools.fileRead
    }
    if (tool.risk === 'write') return config.accessMode === 'full' && config.tools.fileWrite
    return config.accessMode === 'full' && config.tools.shell
  })
}
