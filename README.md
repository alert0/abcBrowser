# abcBrowser

abcBrowser 是基于 Prism Browser Community 管理层、面向 Windows x64 的 Apostate Chromium 桌面环境管理器。

当前第一阶段的产品边界：用户通过文件选择器导入本地已有的 Apostate `chrome.exe`，abcBrowser 复制并验证完整运行目录，为每个环境创建独立用户数据目录，然后提供创建、启动、关闭和重启能力。项目不自动下载或更新内核，也不修改 Chromium/Apostate 源码。

## 文档

- [项目开发规范](docs/development/development-standards.md)
- [Codex 完整开发提示词](docs/development/codex-implementation-prompt.md)
- [Prism × Apostate 集成审查报告](docs/architecture/prism-apostate-integration-review.md)
- [实施记录与真实验证状态](docs/development/implementation-status.md)

## 开发

需要 Node.js 24.19.0 或兼容版本。在 Windows x64 上执行：

```powershell
npm ci
npm run dev
```

类型检查、单元测试和构建：

```powershell
npm run typecheck
npm test
npm run build
npm run dist:win
```

首次运行后，在“浏览器内核”中点击“导入本地内核”，选择完整 Apostate 运行目录中的 `chrome.exe`。导入成功后创建环境，设置启动网址和代理，再启动环境。内核清单只记录本地文件完整性；本地哈希不等于官方来源认证。

## 当前支持

- Windows x64 目标平台。
- Apostate `--fingerprint`、平台、硬件线程数、屏幕尺寸、语言、时区和 `proxy_only` WebRTC UDP 防泄漏参数。
- 独立环境用户数据目录、代理桥、扩展加载、窗口尺寸、启动网址和进程生命周期管理。
- 本地内核导入、关键文件 SHA-256 清单、完整性检查、切换和回滚。

## 暂不支持

- 内核自动下载、在线版本发现和自动更新。
- macOS/Linux 发布版本。
- 旧 Prism 品牌版本、操作系统版本、GPU bucket、render identity、地理位置和 selective spoofing 开关。
- 未经 Apostate 文档与实机验证的 `public_only` WebRTC 映射。
- 将静态启动参数存在当作指纹运行时验证通过。

真实测试结果见 [实施记录](docs/development/implementation-status.md)。
## 本地开发启动

Windows 下可直接双击项目根目录的 `start-dev.cmd`，或在 PowerShell 中执行：

```powershell
.\start-dev.ps1
```

脚本会自动检查依赖；未安装时优先使用 `npm ci`，找不到 npm 时尝试使用可用的 pnpm，然后启动 Electron 开发窗口。也可以继续使用：

```powershell
npm run dev
```


