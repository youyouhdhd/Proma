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

Windows 还需要 Visual Studio 2022 的 Desktop development with C++ 工作负载、Windows SDK，以及与当前 MSVC 工具集匹配的 C++ Spectre-mitigated libraries（x86/x64）。`node-pty` 的 `binding.gyp` 明确启用了 Spectre mitigation；缺少它时会出现 `MSB8040`。

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
6. 用 `electron-rebuild` 将 `node-pty` 重编译到当前 Electron 版本。
7. 用 electron-builder 生成未安装目录和 NSIS 安装包。

成功后检查：

```powershell
Get-ChildItem apps/electron/out -File
Get-FileHash 'apps/electron/out/Proma Setup 0.18.3.exe' -Algorithm SHA256
& 'apps/electron/out/win-unpacked/resources/bin/proma.exe' --help
```

`out/`、`dist/` 和 `apps/electron/resources/bin/` 已被 `.gitignore` 忽略，构建产物不应提交到仓库。

## 当前 Windows 主机的 native 兜底

如果暂时无法安装 Spectre 库，但 `node-pty` 已包含 `prebuilds/win32-x64/`，可以先验证 Electron 能加载预编译 N-API 模块，然后跳过 `electron-rebuild` 完成本地打包：

```powershell
Set-Location apps/electron
bun run build
bun run sync:runtime-deps
bun x electron-builder --win --x64 --publish never
```

这条路径只适合本地验证或临时交付，正式发布优先补齐 Visual Studio native 工具链并执行标准 `dist:win`。验证 unpacked 产物中的 PTY：

```powershell
Set-Location out/win-unpacked
$env:ELECTRON_RUN_AS_NODE = '1'
& '.\Proma.exe' -e "const p=require('./resources/app.asar.unpacked/node_modules/node-pty'); const t=p.spawn(process.env.ComSpec,['/d','/c','echo packaged-native-ok'],{name:'xterm',cols:80,rows:30}); let output=''; t.onData((data)=>output+=data); t.onExit((event)=>{console.log(JSON.stringify({output,exitCode:event.exitCode})); process.exit(event.exitCode)})"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

应看到 `exitCode:0` 和 `packaged-native-ok`。如果 `prebuilds/win32-x64` 不存在，不能使用该兜底路径。

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

在 Visual Studio Installer 中为当前 VS 2022 工具集安装 C++ Spectre-mitigated libraries（x86/x64），重新打开开发者终端后再次运行 `bun run dist:win`。不要用 npm/pnpm 替换 Bun，也不要删除项目对 `node-pty` 的 Spectre 设置来规避 native 构建。

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
