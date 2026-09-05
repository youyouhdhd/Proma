/**
 * McpServerSettings - PROMA MCP Server 设置页
 *
 * 把 PROMA 的本地工具能力（文件/搜索/Git/Shell）通过标准 MCP Server
 * 暴露给 ChatGPT Web 等外部 MCP Client。默认只监听 127.0.0.1，
 * read-only 模式默认开启；公网暴露由外部 tunnel 层负责，不在本页。
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { Loader2, Play, Square, RefreshCw, TerminalSquare } from 'lucide-react'
import type { PromaMcpServerConfig, PromaMcpServerStatus, PromaMcpToolSummary, AgentWorkspace } from '@proma/shared'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsSection } from './primitives/SettingsSection'
import { SettingsCard } from './primitives/SettingsCard'
import { cn } from '@/lib/utils'

const DEFAULT_CONFIG: PromaMcpServerConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 'auto',
  accessMode: 'read-only',
  tools: { fileRead: true, fileWrite: false, search: true, git: true, shell: false },
  auth: { type: 'none' },
}

export function McpServerSettings(): React.ReactElement {
  const [config, setConfig] = React.useState<PromaMcpServerConfig>(DEFAULT_CONFIG)
  const [status, setStatus] = React.useState<PromaMcpServerStatus | null>(null)
  const [tools, setTools] = React.useState<PromaMcpToolSummary[]>([])
  const [workspaces, setWorkspaces] = React.useState<AgentWorkspace[]>([])
  const [busy, setBusy] = React.useState(false)

  const refresh = React.useCallback(async (): Promise<void> => {
    try {
      const [appSettings, serverStatus, toolSummaries] = await Promise.all([
        window.electronAPI.getSettings(),
        window.electronAPI.getMcpServerStatus(),
        window.electronAPI.listMcpServerTools(),
      ])
      setConfig(appSettings.mcpServer ?? DEFAULT_CONFIG)
      setStatus(serverStatus)
      setTools(toolSummaries)
    } catch (error) {
      console.error('[MCP 设置] 加载失败:', error)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
    window.electronAPI.listAgentWorkspaces().then((items) => {
      setWorkspaces(items as unknown as AgentWorkspace[])
    }).catch(() => {})
  }, [refresh])

  /** 保存配置并按需启停（update-config 会持久化 + 重启/停止） */
  const applyConfig = React.useCallback(async (next: PromaMcpServerConfig): Promise<void> => {
    setBusy(true)
    try {
      const status = await window.electronAPI.updateMcpServerConfig(next)
      setStatus(status)
      setConfig(next)
      const toolSummaries = await window.electronAPI.listMcpServerTools()
      setTools(toolSummaries)
    } catch (error) {
      console.error('[MCP 设置] 应用配置失败:', error)
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const toggleEnabled = React.useCallback(async (): Promise<void> => {
    if (busy) return
    const next = { ...config, enabled: !config.enabled }
    await applyConfig(next)
  }, [busy, config, applyConfig])

  const running = status?.running ?? false
  const enabled = config.enabled

  return (
    <SettingsSection
      title="MCP Server"
      description="把 PROMA 当前工作区的文件、搜索、Git 与 Shell 能力通过标准 MCP Server（Streamable HTTP）暴露给 ChatGPT Web 等外部 MCP Client。默认仅监听本机回环地址；工具执行不会调用 PROMA 内置模型。"
    >
      <div className="space-y-4">
        {/* 状态卡片 */}
        <SettingsCard divided={false}>
          <div className="px-4 py-4 space-y-3">
            <div className="flex items-center gap-2">
              <span className={cn('size-2 rounded-full', running ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
              <span className="text-sm font-medium">{running ? 'MCP Server 运行中' : 'MCP Server 已停止'}</span>
              {busy && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
              <div className="ml-auto flex gap-2">
                {!running ? (
                  <Button size="sm" type="button" disabled={busy || !config.workspaceId} onClick={() => void toggleEnabled()}>
                    <Play size={14} /> 启动
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => void toggleEnabled()}>
                    <Square size={14} /> 停止
                  </Button>
                )}
                <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => void refresh()}>
                  <RefreshCw size={14} /> 刷新
                </Button>
              </div>
            </div>
            {running && status && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs space-y-1 text-muted-foreground">
                <div>Local endpoint: <span className="font-mono text-foreground">{status.endpoint}</span></div>
                <div>Active sessions: {status.activeSessions}</div>
              </div>
            )}
            {status?.errorMessage && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive break-all">{status.errorMessage}</div>
            )}
          </div>
        </SettingsCard>

        <SettingsCard divided={false}>
          <div className="px-4 py-4 space-y-4">
            {/* 工作区 */}
            <div className="grid gap-3 md:grid-cols-[180px_1fr] md:items-center">
              <div className="text-sm font-medium">绑定工作区</div>
              <Select
                value={config.workspaceId ?? ''}
                onValueChange={(value) => void applyConfig({ ...config, workspaceId: value })}
              >
                <SelectTrigger className="h-9"><SelectValue placeholder="选择要暴露的工作区" /></SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 端口 */}
            <div className="grid gap-3 md:grid-cols-[180px_1fr] md:items-center">
              <div className="text-sm font-medium">监听端口</div>
              <Select
                value={String(config.port)}
                onValueChange={(value) => void applyConfig({ ...config, port: value === 'auto' ? 'auto' : Number(value) })}
              >
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动选择</SelectItem>
                  {[8787, 8899, 3210].map((port) => (
                    <SelectItem key={port} value={String(port)}>{port}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* 访问模式 */}
            <div className="grid gap-3 md:grid-cols-[180px_1fr] md:items-center">
              <div className="text-sm font-medium">访问模式</div>
              <Select
                value={config.accessMode}
                onValueChange={(value) => void applyConfig({ ...config, accessMode: value as PromaMcpServerConfig['accessMode'] })}
              >
                <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="read-only">只读（推荐）</SelectItem>
                  <SelectItem value="full">完整（含写入 / Shell）</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 写入与 Shell 开关（仅 full 模式生效） */}
            {config.accessMode === 'full' && (
              <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3">
                <div className="text-xs font-medium text-amber-700 dark:text-amber-300">高风险能力（ChatGPT 可直接修改文件或执行本地命令）</div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">允许写入 / 编辑文件</span>
                  <Switch checked={config.tools.fileWrite} onCheckedChange={(v) => void applyConfig({ ...config, tools: { ...config.tools, fileWrite: v } })} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">允许 Shell 执行</span>
                  <Switch checked={config.tools.shell} onCheckedChange={(v) => void applyConfig({ ...config, tools: { ...config.tools, shell: v } })} />
                </div>
                <p className="text-[11px] leading-relaxed text-amber-700/80 dark:text-amber-300/80">PROMA 是最终执行环境：即使 ChatGPT 自带确认，本地路径守卫与工作区边界仍会强制生效。</p>
              </div>
            )}

            {/* Bearer 认证 */}
            <div className="grid gap-3 md:grid-cols-[180px_1fr] md:items-center">
              <div className="text-sm font-medium">访问认证</div>
              <div className="flex items-center gap-2">
                <Select
                  value={config.auth.type}
                  onValueChange={(value) => void applyConfig({ ...config, auth: value === 'bearer' ? { type: 'bearer', token: config.auth.token ?? '' } : { type: 'none' } })}
                >
                  <SelectTrigger className="h-9 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">无认证</SelectItem>
                    <SelectItem value="bearer">Bearer Token</SelectItem>
                  </SelectContent>
                </Select>
                {config.auth.type === 'bearer' && (
                  <Input
                    value={config.auth.token ?? ''}
                    onChange={(e) => setConfig({ ...config, auth: { type: 'bearer', token: e.target.value } })}
                    onBlur={() => void applyConfig(config)}
                    placeholder="Bearer Token"
                    className="h-9 flex-1 font-mono text-xs"
                  />
                )}
              </div>
            </div>
          </div>
        </SettingsCard>

        {/* 工具列表 */}
        <SettingsCard divided={false}>
          <div className="px-4 py-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium"><TerminalSquare size={14} /> 工具列表（{tools.filter((t) => t.enabled).length}/{tools.length} 启用）</div>
            {tools.length === 0 ? (
              <div className="text-xs text-muted-foreground">加载中…</div>
            ) : (
              <div className="space-y-1">
                {tools.map((tool) => (
                  <div key={tool.name} className="flex items-center gap-2 text-xs">
                    <span className={cn('size-1.5 rounded-full', tool.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />
                    <span className={cn('font-mono', tool.enabled ? 'text-foreground' : 'text-muted-foreground/50')}>{tool.name}</span>
                    <span className="text-muted-foreground/70">{tool.risk === 'read' ? '只读' : tool.risk === 'write' ? '写入' : '执行'}</span>
                    <span className="truncate text-muted-foreground/60">{tool.description}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SettingsCard>

        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/70 flex items-start gap-1.5">
          <TerminalSquare size={12} className="mt-0.5 shrink-0" />
          <span>ChatGPT Web 无法直接访问本机地址：请用 Secure MCP Tunnel 等工具把上面的 endpoint 暴露为 HTTPS 后，在 ChatGPT 的 Developer Mode 中添加。</span>
        </p>
      </div>
    </SettingsSection>
  )
}
