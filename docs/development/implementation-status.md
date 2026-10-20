# abcBrowser 实施记录

## 基线

- Prism Browser Community：`DFarm6/Prism-Browser-Community@f23feb26ce998a75ba41529cc1464a34a03ee8c1`
- Apostate 目标发行版：`v0.5.1`
- Apostate Chromium 基线：`155.0.8059.31`
- 当前目标：Windows x64
- 内核来源：用户本地选择的完整 Apostate 运行目录；来源状态为“本地导入，来源未验证”

## 已实现

- 将 Prism 的 Electron、React、TypeScript 应用源码纳入 abcBrowser 工作基线。
- 新增 `src/main/engines/apostate/`，集中管理能力声明、版本解析和启动参数。
- 启动链仅生成 Apostate 文档确认的指纹开关：种子、平台、CPU 线程、屏幕、语言、时区和 WebRTC UDP。
- 不再透传品牌版本、旧 GPU bucket、地理位置、旧 render identity 和 selective spoofing 开关。
- `public_only` WebRTC 不做未经验证的静默映射；启动前给出错误。
- 本地导入限制在所选 `chrome.exe` 的最多三个父级目录内，要求发现运行时 DLL/资源后才复制。
- 导入在临时目录完成，复制后生成关键文件 SHA-256 清单，再原子切换并保留旧内核。
- 关闭内核自动下载和在线发行版发现；第一阶段只支持导入本地内核。
- 添加 Apostate Adapter 单元测试和 Windows x64 CI 配置。

## 已执行验证

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` | PASS | 使用 Codex bundled Node.js 24.19.0 |
| `node node_modules/vitest/vitest.mjs run --fileParallelism=false src/shared src/renderer/src src/main/engines/apostate` | PASS | 10 files，56 tests |
| `node node_modules/electron-vite/bin/electron-vite.js build` | PASS | main、preload、renderer 均构建成功 |
| `npm test` 等价完整 Vitest 套件 | BLOCKED | `profile-store.test.ts` 在当前环境启动后无输出并持续挂起，已终止；部分上游生命周期测试依赖桌面进程/外部运行环境 |
| Windows x64 真实 Apostate 启动 | NOT RUN | 当前环境没有用户提供的 Apostate `chrome.exe` |

## 尚未完成

- 需要在 Windows x64 桌面环境中使用真实 Apostate `chrome.exe` 完成导入、启动、关闭、重启和数据持久化验收。
- GPU anchor、WebRTC 行为、代理协议和浏览器实际暴露值仍需实机运行时证据；代码未将静态参数存在视为验证通过。
- 生产安装包需要在 GitHub Actions 的 Windows runner 上完成实际打包验收。
