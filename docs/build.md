# Proma 本地构建指南

本文面向需要维护 Proma Fork、在本机运行开发版本或生成桌面安装包的开发者。目标是让构建者能从当前仓库复现 `dist` 目录和平台安装包，并知道 native 依赖失败时应检查什么。

## 构建入口与产物

Proma 是 Bun workspace，桌面应用位于 `apps/electron`。根目录命令会通过 workspace filter 调用桌面包脚本：

| 目标 | 命令 | 主要产物 |
| --- | --- | --- |
| 只编译桌面应用 | `bun run electron:build` | `apps/electron/dist/`、内置 `proma` CLI |
| Windows x64 安装包 | `bun run --filter='@proma/electron' dist:win` | `apps/electron/out/Proma Setup <version>.exe` |
| macOS 当前架构/配置 | `bun run dist:mac` | `apps/electron/out/` 下的 DMG/ZIP |
| Linux 当前主机构建 | `bun run --filter='@proma/electron' dist:linux` | `apps/electron/out/` 下的 Linux 产物 |
| 仅生成未安装目录 | `bun run --filter='@proma/electron' pack` | `apps/electron/out/` 下的平台 unpacked 目录 |

也可以进入 `apps/electron` 后直接运行相同的包级脚本，例如 `bun run dist:win`。应用版本来自 `apps/electron/package.json`，electron-builder 会据此命名安装包。

## 前置条件

- Git。
- Bun。CI 使用 `oven-sh/setup-bun@v2` 的 latest；本指南在 Bun 1.4.0 上验证。
- Node.js 22。仓库的发布工作流使用 Node.js 22，native 构建和 `node-gyp` 也应优先使用该版本。
- 可访问 GitHub Release 的网络。首次安装 Electron、electron-builder 的 NSIS/winCodeSign 工具链时会下载缓存。

标准 Windows 打包会验证并使用 `node-pty` 随包提供的 N-API 预编译产物，不要求本机安装完整 C++ 工具链。只有显式执行源码重编译，或预编译缺失/无法被 Electron 加载时，才需要 Visual Studio 2022 的 Desktop development with C++、Windows SDK 和 C++ Spectre-mitigated libraries（x86/x64）。

确认工具链：

```powershell
bun --version
node --version
git --version
```

如果刚安装 Bun 后出现 `bun is not recognized`，重启终端，或把 `C:\Users\<用户名>\.bun\bin` 加入当前用户的 PATH。`apps/electron/scripts/build-cli.ts` 会在子进程中按 PATH 查找 Bun。

## 标准 Windows 构建

在仓库根目录执行：

```powershell
bun install --frozen-lockfile
bun run typecheck
bun test
bun run --filter='@proma/electron' dist:win
```

`dist:win` 的顺序是：

1. 用 esbuild 编译 main、Agent runtime、terminal runtime 和 preload。
2. 用 Vite 编译 renderer。
3. 用 `bun build --compile` 生成随应用分发的 `proma.exe` CLI。
4. 跳过 macOS-only native helper。
5. 把 Pi runtime、`pdfjs-dist`、`sharp` 和 `node-pty` 的运行时依赖闭包同步到 `apps/electron/node_modules`。
6. 用 `prepare:node-pty` 在 Electron 中实际启动 PTY：Windows 预编译验证通过则直接使用；否则回退 `electron-rebuild`。macOS/Linux 保持源码重编译。
7. 用 electron-builder 生成未安装目录和 NSIS 安装包。

成功后检查：

```powershell
Get-ChildItem apps/electron/out -File
$installer = Get-ChildItem 'apps/electron/out/Proma Setup *.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256
& 'apps/electron/out/win-unpacked/resources/bin/proma.exe' --help
```

`out/`、`dist/` 和 `apps/electron/resources/bin/` 已被 `.gitignore` 忽略，构建产物不应提交到仓库。

## Windows node-pty 策略

`dist:win` 已内置可复现的预编译验证，不再需要手工跳过 `electron-rebuild`：

```powershell
bun run --filter='@proma/electron' sync:runtime-deps
bun run --filter='@proma/electron' prepare:node-pty
```

验证脚本检查当前架构的 `conpty.node`、`conpty_console_list.node`、`pty.node`、`winpty-agent.exe` 和 `winpty.dll`，再通过 `ELECTRON_RUN_AS_NODE=1` 实际启动一次终端。只有完整通过才允许打包继续。

如需验证从源码构建，执行：

```powershell
bun run --filter='@proma/electron' rebuild:node-pty
```

该命令不会关闭 `SpectreMitigation`；Windows 缺少 Spectre 库时会明确失败。验证 unpacked 产物中的 PTY：

```powershell
Set-Location out/win-unpacked
$env:ELECTRON_RUN_AS_NODE = '1'
& '.\Proma.exe' -e "const p=require('./resources/app.asar.unpacked/node_modules/node-pty'); const t=p.spawn(process.env.ComSpec,['/d','/c','echo packaged-native-ok'],{name:'xterm',cols:80,rows:30}); let output=''; t.onData((data)=>output+=data); t.onExit((event)=>{console.log(JSON.stringify({output,exitCode:event.exitCode})); process.exit(event.exitCode)})"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

应看到 `exitCode:0` 和 `packaged-native-ok`。

## 其他平台

native 模块按当前主机编译，跨平台发布应在对应 runner 或对应平台机器上执行：

```powershell
# macOS
bun run dist:mac

# Linux（进入 apps/electron 后运行）
Set-Location apps/electron
bun run dist:linux
```

macOS 还需要 Xcode command-line tools；EventKit addon 和 Agent Island helper 会在 macOS 构建时由 `xcrun` 编译。签名/公证需要额外的 Apple 证书和环境变量；本地验证可关闭自动签名发现。

## 发布工作流

`.github/workflows/release.yml` 在推送 `v*` tag 时运行。CI 使用 Bun、Node.js 22 和 `bun install --frozen-lockfile`，macOS 按 arm64/x64 分别构建，Windows 构建 x64 并上传到 GitHub Release。发布需要相应的 `GH_TOKEN`；macOS 签名、公证还需要 workflow 文件中列出的 Secrets。

本地构建不要使用 `--publish always`。需要发布时应在确认版本、签名、GitHub Release 目标和产物完整后再执行。

## 常见问题

### `bun` 找不到或 `build-cli` 报 `exit undefined`

重启终端，确认 `bun --version` 能执行，并确认 Bun 安装目录位于 PATH。CLI 编译脚本会额外复制一个短路径 Bun 处理 Windows 长路径问题，但仍要求子进程能通过 PATH 找到 `bun`。

### `MSB8040: 此项目需要缓解了 Spectre 漏洞的库`

这个错误只表示源码重编译缺少一个 Visual Studio 可选组件，不是缺少两个 npm 依赖。在 Visual Studio Installer 中为当前 VS 2022 工具集安装 C++ Spectre-mitigated libraries（x86/x64）；组件 ID 为 `Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre`。重新打开终端后运行 `bun run --filter='@proma/electron' rebuild:node-pty` 验证。不要删除 `binding.gyp` / `winpty.gyp` 中的 Spectre 声明来绕过安全加固。

官方 Windows CI 当前直接打包 node-pty 的预编译 N-API 产物，并不执行源码 `electron-rebuild`；因此官方构建成功不能证明 CI 安装了 Spectre 组件。

### Vite 提示 chunk 大于 500 kB

这是当前 renderer 的体积警告，不会使构建失败。只有在需要优化首屏或加载性能时，才进一步拆分动态 import 或配置 `manualChunks`。

### 测试使用临时配置目录

`planning-manager` 测试会在临时用户目录中运行独立 Electron Node 进程；Windows 同时设置 `HOME` 和 `USERPROFILE`，避免 Node 的 `os.homedir()` 与测试断言指向不同目录。测试失败时先确认没有残留 Electron/Node 进程占用临时目录，再单独运行：

```powershell
bun test apps/electron/src/main/lib/planning-manager.test.ts
```

## 相关文件

- [根目录 package.json](../package.json)：workspace 命令和版本元数据。
- [Electron package.json](../apps/electron/package.json)：桌面构建、重编译和分发脚本。
- [electron-builder.yml](../apps/electron/electron-builder.yml)：应用、资源、asar 和平台目标配置。
- [release.yml](../.github/workflows/release.yml)：CI 发布矩阵。
- [Fork 维护与上游同步指南](./fork-maintenance.md)：记录本 Fork 的定制提交及未来重放流程。
