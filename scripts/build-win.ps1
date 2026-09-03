# 一键构建 Windows exe 安装包脚本
#
# 用法（在仓库根目录执行）：
#   powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1              # 仅构建
#   powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1 -Push        # 构建成功后推送 origin main
#   powershell -ExecutionPolicy Bypass -File scripts/build-win.ps1 -SkipCheck   # 跳过 typecheck/test（快速构建）
#
# 产物位置：apps/electron/out/Proma Setup <版本>.exe（NSIS 安装程序，x64）

param(
    [switch]$Push,
    [switch]$SkipCheck
)

$ErrorActionPreference = 'Stop'

# 以脚本所在目录定位仓库根，保证从任意工作目录调用都正确
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

function Invoke-Step {
    param([string]$Name, [scriptblock]$Action)
    Write-Host ""
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Action
    if ($LASTEXITCODE -ne 0) {
        Write-Host "步骤失败：$Name（退出码 $LASTEXITCODE）" -ForegroundColor Red
        exit $LASTEXITCODE
    }
}

Write-Host "Proma Windows 构建开始：$RepoRoot" -ForegroundColor Green

Invoke-Step '安装依赖（bun install）' { bun install }

if (-not $SkipCheck) {
    Invoke-Step '全仓类型检查' { bun run typecheck }
    Invoke-Step '单元测试' { bun test }
}

Invoke-Step '构建全部工作区包' { bun run build }
Invoke-Step '打包 Windows 安装程序（electron-builder --win）' {
    Push-Location apps/electron
    try { bun run dist:win } finally { Pop-Location }
}

# 校验产物存在
$Installer = Get-ChildItem -Path (Join-Path $RepoRoot 'apps/electron/out') -Filter '*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Installer) {
    Write-Host '构建完成但未在 apps/electron/out 找到 exe 产物' -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "构建成功：$($Installer.FullName)" -ForegroundColor Green

if ($Push) {
    Invoke-Step '推送 origin main' { git push origin main }
    Write-Host '已推送到远端' -ForegroundColor Green
}
