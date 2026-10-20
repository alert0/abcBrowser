# Prism Browser Community × Apostate 内核集成审查报告

> **审查日期：** 2026-10-20  
> **项目仓库：** [alert0/abcBrowser](https://github.com/alert0/abcBrowser)  
> **审查对象：** [Prism Browser Community](https://github.com/DFarm6/Prism-Browser-Community) × [Apostate](https://github.com/heretic-tech/apostate)  
> **目标平台：** Windows x64 优先  
> **审查类型：** 公开源码、发行清单与关键调用链的静态架构审查  
> **结论状态：** 有条件推荐；尚未完成实际运行验收

## 1. 执行摘要

建议以 Prism Browser Community 作为浏览器管理器基础，以 Apostate 作为候选 Chromium 内核，通过独立的 **Apostate Engine Adapter** 进行集成。

不要重写整个桌面应用，也不要把 Apostate 当成普通 Chrome 可执行文件直接替换。应优先复用环境管理、数据目录、代理桥、进程生命周期等能力，并重构内核发行管理和启动参数转换。

### 核心判断

1. **可以复用：** Prism 的环境持久化、浏览器启动生命周期、代理桥和大部分桌面管理层。
2. **必须修改：** 内核定位、内核下载/校验/安装、启动参数构造、指纹配置模型和配置界面。
3. **最大风险：** UI 中的配置被保存了，但 Apostate 实际没有应用；尤其是 GPU、操作系统版本、地理位置、WebRTC 和 Prism 专用参数。
4. **首个里程碑：** 先完成 Windows x64 本地导入、SHA-256 校验、最小启动、环境隔离测试；通过后再批量修改代码。
5. **本报告不代表已集成：** 本次只做静态审查，没有修改 Prism 或 Apostate 源码，也没有在 Windows 环境执行测试。

## 2. 仓库与版本基线

### 2.1 Prism Browser Community

- 公开仓库：[DFarm6/Prism-Browser-Community](https://github.com/DFarm6/Prism-Browser-Community)
- 公开 Release：v0.3.22
- 公开发行日期：2026-10-03
- 公开 README 声明：从 v0.3.17 开始，后续产品功能和修复不再常规同步到公开仓库。
- 静态审查时观察到，根目录 `package.json` 版本仍为 `0.2.0-beta.1`，而公开 Release 已到 v0.3.22；内核锁文件仍指向 Fingerprint Chromium `144.0.7559.132`。

这说明应用包版本、GitHub Release 版本和浏览器内核版本必须分别管理，不能视为同一版本号。公开仓库维护状态也意味着我们应固定审查过的提交，建立自己的变更和发布流程。

参考：
- [Prism README](https://github.com/DFarm6/Prism-Browser-Community/blob/main/README.en.md)
- [Prism package.json](https://github.com/DFarm6/Prism-Browser-Community/blob/main/package.json)
- [Prism kernel-lock.json](https://github.com/DFarm6/Prism-Browser-Community/blob/main/tools/kernel-lock.json)

### 2.2 Apostate

- 公开仓库：[heretic-tech/apostate](https://github.com/heretic-tech/apostate)
- 发行版：v0.5.1
- 发行日期：2026-09-30
- Chromium 版本：`155.0.8059.31`
- Windows x64 发行包：`apostate-155.0.8059.31-windows-x64.zip`
- Python 包许可证：GPL-3.0-only；Node 包声明 GPL-3.0-or-later。

发行清单记录了平台、Chromium 版本及 SHA-256。集成时应使用受信任的官方 Release 和清单，而不是只按文件名判断来源。

参考：
- [Apostate v0.5.1 Release](https://github.com/heretic-tech/apostate/releases/tag/v0.5.1)
- [Apostate release-manifest.json](https://github.com/heretic-tech/apostate/blob/main/python/apostate/assets/release-manifest.json)
- [Apostate Python 项目配置](https://github.com/heretic-tech/apostate/blob/main/python/pyproject.toml)
- [Apostate Node 包配置](https://github.com/heretic-tech/apostate/blob/main/npm/package.json)

## 3. 推荐架构

建议维持 Prism 的桌面应用与管理层，在主进程增加独立的内核适配边界。

```text
React Renderer
  ├─ 环境列表与编辑
  ├─ 代理配置
  └─ 内核管理 UI
        │
        ▼
Electron IPC / Main Process
  ├─ ProfileStore
  ├─ BrowserLauncher
  ├─ ProxyBridge
  ├─ ProcessInspector
  ├─ KernelManager
  └─ ApostateEngineAdapter  ← 新增
        ├─ 版本与能力声明
        ├─ 配置字段转换
        ├─ 命令行参数构造
        ├─ 发行包校验
        └─ 启动后验证
        │
        ▼
Apostate Chromium (chrome.exe)
  ├─ 独立 user-data-dir
  ├─ 浏览器身份 / 指纹参数
  └─ 网络与代理配置
```

### 设计原则

- 不把 Apostate 专属逻辑散落到 React 组件或通用启动器各处。
- 用统一接口表达内核能力，前端只能显示当前内核确实支持的配置。
- 为内核版本和能力定义显式清单，不依赖“某个参数看起来像 Chromium 参数”来推断支持情况。
- 运行期校验与静态配置分离：参数写入启动命令不等于内核实际生效。
- 在初期保留现有 Prism 环境数据结构，避免同时迁移用户数据和替换内核。

## 4. Prism 模块复用与修改建议

| 模块 | 建议 | 原因与改动 |
|---|---|---|
| `src/main/profile-store.ts` | 保留 | 已有环境持久化、复制、删除和数据管理逻辑；需验证新内核目录布局。 |
| `src/main/profile-data.ts` | 保留并测试 | 继续负责用户数据；确认缓存与用户数据路径和 Chromium 行为兼容。 |
| `src/main/proxy-bridge.ts` | 原则上保留 | 已有本地代理桥和上游代理认证处理；需对不同代理协议做回归测试。 |
| `src/main/process-inspector.ts` | 保留并测试 | 通过 `--user-data-dir` 等信息关联环境进程；验证 Apostate 的命令行与进程树。 |
| `src/main/browser-launcher.ts` | 保留主体、改造调用链 | 保留启动/停止、并发限制、异常进程处理；改为调用 Engine Adapter。 |
| `src/main/browser-locator.ts` | 修改 | 识别内核来源、安装状态、版本和架构。 |
| `src/main/kernel-manager.ts` | 重点修改 | 当前下载、发行校验和安装仍绑定旧内核发行体系。 |
| `src/main/launch-args.ts` | 重构 | 不能原样复用 Fingerprint Chromium 专用参数。 |
| `src/shared/types.ts` | 调整 | 标记 Apostate 支持、不支持和待验证的配置能力。 |
| `src/shared/defaults.ts` | 调整 | 默认值应符合 Apostate 的实际参数和能力边界。 |
| `src/shared/network-identity.ts` | 复用并改造 | 可保留代理出口推导语言/时区的思路，但需按新参数协议输出。 |
| `src/renderer/src/ProfileEditor.tsx` | 调整 | 隐藏或重新定义未支持的字段，避免用户误认为配置已生效。 |

参考：
- [Prism main process](https://github.com/DFarm6/Prism-Browser-Community/tree/main/src/main)
- [Prism launch-args.ts](https://github.com/DFarm6/Prism-Browser-Community/blob/main/src/main/launch-args.ts)
- [Prism ProfileEditor.tsx](https://github.com/DFarm6/Prism-Browser-Community/blob/main/src/renderer/src/ProfileEditor.tsx)

## 5. 内核导入、安装和完整性

### 5.1 本地导入：适合作为第一阶段验证入口

Prism 的 `KernelManager.importLocal()` 已包含本地可执行文件选择、Windows 文件版本读取、目录复制及部分完整性清单生成等流程。Apostate 的 Windows 发行包以 `chrome.exe` 作为浏览器入口，因此存在可复用基础。

参考：[Prism kernel-manager.ts](https://github.com/DFarm6/Prism-Browser-Community/blob/main/src/main/kernel-manager.ts)。

但必须验证：

- Windows 文件版本读取是否能正确得到 `155.0.8059.31`。
- 所有必要 DLL、资源文件和子目录是否被完整复制。
- 复制后的内核是否能够在目标 Windows x64 环境启动。
- 安装目录中的文件是否与经过校验的官方发行包一致。
- 内核切换、卸载、重新安装和回滚是否可靠。

Prism 对单个可执行文件或部分关键文件生成摘要，不等于对整个发行包做了官方来源认证。静态导入成功也不能证明运行兼容。

### 5.2 自动下载器不能只替换 URL

Prism 当前内核管理逻辑仍指向旧的 Fingerprint Chromium 发行体系，包括旧仓库地址、发行包命名规则和下载来源白名单。Apostate 的发布标签、文件名及清单结构不同。

建议增加独立的发行来源配置，至少记录：

- `engineId`: `apostate`
- Apostate 发布标签，例如 `v0.5.1`
- Chromium 四段式版本，例如 `155.0.8059.31`
- OS 与 CPU 架构
- 官方 Release URL
- 发行包文件名
- 官方 SHA-256
- 安装后关键文件摘要
- 安装时间、来源和校验结果

初期可以继续用 Chromium 四段式版本绑定环境，但必须同时保存 Apostate 发布标签。不能让相同 Chromium 版本、不同 Apostate 包内容互相覆盖。

### 5.3 安全安装要求

- 只接受预先允许的官方仓库与 Release URL。
- 下载后先校验 SHA-256，再解压。
- 解压时防止路径穿越、绝对路径写入及意外覆盖。
- 校验关键文件和入口可执行文件是否存在。
- 安装失败时清理临时文件，不改变当前可用内核。
- 安装与切换必须是可回滚的事务式流程。
- 日志记录版本和校验结果，不记录代理密码或其他秘密。

Apostate v0.5.1 Windows x64 发行包在当前审查快照中的 SHA-256：

```text
8e55e44fb7f58619461e1d42a947446dcc08a2b46493c420c8e62ae27ab9c7e5
```

下载前应再次从官方 Release/清单核实，不应把本文中的摘要硬编码为所有未来版本的常量。

## 6. 指纹参数兼容性

最重要的原则：**Prism 字段名称、保存成功和启动参数出现，都不能证明 Apostate 实际支持该功能。**

参数映射应由单独的 Adapter 完成，并通过测试验证。

| Prism 现有功能 | Apostate 对应能力/参数 | 建议 |
|---|---|---|
| 指纹种子 | `--fingerprint` | 保留并验证稳定性。 |
| 模拟系统平台 | `--fingerprint-platform` | 保留，限定支持值。 |
| CPU 线程数 | `--fingerprint-hardware-concurrency` | 保留并验证运行时结果。 |
| 屏幕宽高 | `--fingerprint-screen-width` / `--fingerprint-screen-height` | 保留并验证。 |
| 设备内存 | `--fingerprint-device-memory` | 新增映射并测试。 |
| 语言与 Accept-Language | `--fingerprint-locale` | 统一转换；验证列表顺序和浏览器暴露值。 |
| 时区 | `--fingerprint-timezone` | 统一转换并测试。 |
| GPU 模板 | `--fingerprint-anchor` 及相关 GPU 参数 | 重建映射，不直接复用 Prism 的 bucket 编号。 |
| 代理 | 标准 `--proxy-server` 或现有本地代理桥 | 保留并进行协议、认证和 DNS 行为测试。 |
| 窗口尺寸/位置 | 标准 Chromium 参数 | 保留并回归测试。 |
| 扩展加载 | `--load-extension` | 保留并验证实际加载。 |
| CDP 调试 | Chromium CDP 参数/现有控制方式 | 保持现有安全边界，验证 Windows 行为。 |
| 品牌版本 | 由真实内核版本决定 | 自动匹配，避免伪造版本不一致。 |
| OS 版本 | 没有已确认的直接等效启动参数 | 第一版移除可编辑项或明确标记不支持。 |
| 地理位置模拟 | 当前参数文档中没有已确认的等效原生参数 | 不宣称支持；另行设计并测试。 |
| 选择性关闭指纹伪装 | 没有直接等效参数 | 暂不支持。 |
| Prism 渲染身份版本 | 没有直接等效参数 | 重新设计或移除。 |

参考：
- [Apostate switches](https://github.com/heretic-tech/apostate/blob/main/docs/reference/switches.mdx)
- [Apostate Profile Schema](https://github.com/heretic-tech/apostate/blob/main/docs/reference/profile-schema.mdx)

### 6.1 设备 Profile 与种子模式

Apostate 提供 `--apostate-profile`，但设备 Profile 会替代普通的种子组合逻辑。不要为了迁就几个 Prism 字段而生成不完整 Profile，否则未指定的字段可能回退到宿主机值。

建议第一版将配置模式明确分开：

- **Seed-based：** 由种子与受支持参数组合生成身份。
- **Explicit Profile：** 使用完整且经过校验的设备 Profile。
- **Host-derived：** 只有经过验证的能力才允许声明为宿主机继承。

不要把三种模式混为一个“随机指纹”选项。

### 6.2 GPU 模板

Prism 的 GPU 目录、`gpuBucket` 和 `renderIdentityVersion` 属于原有实现；Apostate 使用自己的 GPU family anchor 和相关参数，两套编号不能直接对应。

建议先建立经过验证的有限模板，并为每个模板记录来源、支持平台、参数集合和测试结果。未验证的 GPU 模板不要显示为可用选项。

同时测试 WebGL、WebGPU、实际平台标识与模板之间的一致性；仅验证参数已传入不够。

### 6.3 语言、时区和地理位置

可以保留 Prism 根据代理出口推导语言、Accept-Language 和时区的思路，但必须按 Apostate 的 `--fingerprint-locale` 与 `--fingerprint-timezone` 重新生成参数。

当前不能把 Prism 原有 `--fingerprint-location` 直接映射为 Apostate 已支持的能力。第一版应区分“根据出口推导语言/时区”与“浏览器 Geolocation API 返回指定坐标”，后者未经实现和测试不得宣称支持。

### 6.4 WebRTC

Apostate 文档提供 `--fingerprint-webrtc-udp=direct` 或 `block` 等控制，并对代理类型有特定行为。Prism 的本地代理桥可能使上游代理在浏览器看来成为本地 HTTP 代理，因此不能仅凭上游代理类型推断 WebRTC 行为。

建议：
- 对应 `proxy_only` 的策略可先评估映射到 `block`。
- `default` 应明确表示使用 Apostate 默认值，并进行实测。
- `public_only` 没有经过验证的直接映射时，不应静默转换；需重新定义语义并提供风险说明。
- 通过实际网络测试验证行为，不只检查命令行。

参考：[Apostate switches](https://github.com/heretic-tech/apostate/blob/main/docs/reference/switches.mdx)。

## 7. 代理、数据隔离与进程生命周期

### 7.1 可复用能力

Prism 已有独立环境目录、代理配置、本地代理桥、启动状态管理和遗留进程检查。Apostate 仍基于 Chromium，可以继续使用 `--user-data-dir` 组织每个环境的数据目录。

参考：[Apostate raw binary guide](https://github.com/heretic-tech/apostate/blob/main/docs/guides/raw-binary.mdx)。

### 7.2 必须补齐的回归测试

1. 同一环境关闭后重启，Cookie、登录状态和预期的种子保持稳定。
2. 复制环境后，用户数据目录隔离，并按产品规则重新生成种子。
3. 多环境并发运行时，数据目录、代理桥和进程归属互不串线。
4. HTTP、HTTPS、SOCKS5 及认证代理可按预期工作。
5. 启动失败、崩溃和正常关闭后，本地代理桥都能正确清理。
6. 遗留进程检查不会误杀其他环境或其他应用的 Chromium。
7. 日志、崩溃信息和诊断输出不泄露代理密码。
8. CDP 控制端口不暴露到公网，端口冲突时有明确错误处理。
9. 用户数据迁移、内核切换和回滚不覆盖或损坏现有环境。

Prism 在 Windows 上的 CDP 控制方式与 macOS/Linux 不完全相同。第一阶段应优先保持现有 Windows 机制并进行验证，不必同时重写自动化控制通道。

## 8. 许可证与发行合规

| 项目 | 当前声明 |
|---|---|
| Prism Browser Community | MIT |
| Apostate Python 包 | GPL-3.0-only |
| Apostate Node 包 | GPL-3.0-or-later |

参考：
- [Prism LICENSE](https://github.com/DFarm6/Prism-Browser-Community/blob/main/LICENSE)
- [Apostate Python project](https://github.com/heretic-tech/apostate/blob/main/python/pyproject.toml)
- [Apostate Node package](https://github.com/heretic-tech/apostate/blob/main/npm/package.json)

单独启动 `chrome.exe` 不会自动消除分发 GPL 组件时的合规义务。正式发布前，应根据实际组合方式、修改情况和分发形式进行许可证审查。

至少应做到：

- 保留 Apostate、Chromium 及其他第三方依赖的许可证与版权声明。
- 记录准确的发行版本和源码来源。
- 若修改或重新构建相关组件，准备适用许可证要求的源码及构建资料。
- 不将产品自身许可声明与第三方组件许可证冲突。
- 不假定 MIT 许可证自动授予 Prism 名称、Logo 或其他品牌资产的商标使用权；自有发行版应使用自己的产品标识。

## 9. 分阶段实施计划

### Phase 1 — Windows x64 兼容性验证（优先）

- 固定 Prism 审查提交及 Apostate Release。
- 下载官方 Windows x64 发行包并核对 SHA-256。
- 通过 Prism 本地导入流程安装。
- 验证 Windows 文件版本识别、必要 DLL/资源复制和最小启动。
- 验证独立 `user-data-dir`、正常关闭与再次启动。
- 输出可复现的测试记录，暂不大规模改动代码。

**交付物：** 兼容性验证报告、测试环境记录、问题清单。

### Phase 2 — Apostate Engine Adapter

- 定义内核接口与能力声明。
- 独立实现启动参数构造器。
- 对每个配置字段标记支持、不支持、待验证。
- 添加参数构造、无效配置和版本能力单元测试。
- 保证旧内核逻辑不被无意破坏。

**交付物：** Adapter、类型定义、单元测试。

### Phase 3 — 内核管理器重构

- 新增 Apostate 官方发行来源。
- 分别记录 Apostate Release 与 Chromium 版本。
- 实现 SHA-256 校验、安全解压、完整性检查。
- 实现安装失败回滚和内核切换。
- 补充安装、升级、重复安装和损坏包测试。

**交付物：** 可重复安装、校验、启用和回滚的内核管理。

### Phase 4 — 配置 UI 与环境数据兼容

- 隐藏不支持的指纹字段。
- 重建 GPU 模板和参数映射。
- 在界面显示内核来源、版本和能力状态。
- 保留环境、代理与用户数据管理。
- 明确标注未经验证的配置，不将其显示为已支持。

**交付物：** 与 Apostate 能力一致的配置界面。

### Phase 5 — Windows 验收与发布准备

- 执行多环境隔离、代理、指纹一致性和进程恢复测试。
- 运行类型检查、单元测试和生产构建。
- 测试 Windows 安装包、升级、卸载和回滚。
- 完成第三方许可证与发布说明。
- 通过验收后再评估 macOS 等平台。

**交付物：** 验收报告、可复现构建说明、发布清单。

## 10. 验收测试矩阵

以下为待执行清单，不代表已经通过。

### 10.1 内核安装

- [ ] 官方发行包 SHA-256 不匹配时拒绝安装。
- [ ] 正确识别 Chromium 四段式版本与 Apostate 发布标签。
- [ ] 缺失 DLL 或关键资源时给出明确错误。
- [ ] 同版本但内容不同的内核不会被错误覆盖。
- [ ] 安装失败不会破坏当前可用内核。
- [ ] 解压流程拒绝路径穿越和意外目录覆盖。

### 10.2 环境隔离

- [ ] 同一环境重启后保留预期的种子、Cookie 与登录状态。
- [ ] 复制环境后用户数据目录相互独立。
- [ ] 多环境同时运行时代理与进程不串线。
- [ ] 异常退出后能清理对应代理桥和遗留进程。

### 10.3 参数和指纹一致性

- [ ] 实际读取并验证 platform、userAgent 和 Client Hints。
- [ ] 验证 languages、时区、屏幕尺寸、CPU 线程数和设备内存。
- [ ] 验证 GPU、WebGL、WebGPU 与所选模板的一致性。
- [ ] 验证 WebRTC 行为符合显式配置。
- [ ] 验证不支持的参数不会静默显示为成功。
- [ ] 验证同一环境重新启动时身份行为符合产品设计。

### 10.4 代理与生命周期

- [ ] HTTP、HTTPS、SOCKS5 和认证代理测试通过。
- [ ] 启动失败、正常关闭、崩溃后的代理桥清理正常。
- [ ] 重复启动、并发启动和遗留进程处理正常。
- [ ] 日志不泄露代理凭据。
- [ ] CDP 端口不会意外暴露到公网。

### 10.5 构建与发布

- [ ] 类型检查通过。
- [ ] 单元测试通过。
- [ ] Windows x64 生产构建通过。
- [ ] 安装、升级、卸载与回滚通过。
- [ ] 第三方许可证和版权声明完整。
- [ ] 发布产物具有可复现的版本与校验记录。

静态审查中没有找到独立的 `kernel-manager.test.ts`，也没有找到直接针对 `launch-args.ts` 的专门测试文件。因此这两部分应优先补齐测试。

参考：[Prism package.json](https://github.com/DFarm6/Prism-Browser-Community/blob/main/package.json)。

## 11. 最终结论与下一步

**有条件推荐采用 Prism 管理层 + Apostate 内核的集成路线。**

执行顺序应是：

1. 先验证 Windows x64 本地导入、最小启动和环境隔离。
2. 再实现独立的 Apostate Engine Adapter，明确每个参数的实际支持状态。
3. 随后重构发行下载、SHA-256 校验、版本绑定和回滚。
4. 最后调整 UI、补齐测试并进行发行合规检查。

在第一阶段通过之前，不建议大规模改造现有启动链或删除旧内核路径。

### 审查范围说明

本报告基于公开源码、项目配置、发行清单和关键调用链进行静态审查。未执行 Windows 实机启动、`npm test`、生产打包或真实网络指纹测试。所有运行时兼容性结论仍需通过上述验收矩阵确认。

## 12. 主要参考资料

- [Prism Browser Community repository](https://github.com/DFarm6/Prism-Browser-Community)
- [Prism README](https://github.com/DFarm6/Prism-Browser-Community/blob/main/README.en.md)
- [Prism kernel manager](https://github.com/DFarm6/Prism-Browser-Community/blob/main/src/main/kernel-manager.ts)
- [Prism browser launcher](https://github.com/DFarm6/Prism-Browser-Community/blob/main/src/main/browser-launcher.ts)
- [Prism launch args](https://github.com/DFarm6/Prism-Browser-Community/blob/main/src/main/launch-args.ts)
- [Apostate repository](https://github.com/heretic-tech/apostate)
- [Apostate v0.5.1 Release](https://github.com/heretic-tech/apostate/releases/tag/v0.5.1)
- [Apostate switch reference](https://github.com/heretic-tech/apostate/blob/main/docs/reference/switches.mdx)
- [Apostate Profile Schema](https://github.com/heretic-tech/apostate/blob/main/docs/reference/profile-schema.mdx)
- [Apostate raw binary guide](https://github.com/heretic-tech/apostate/blob/main/docs/guides/raw-binary.mdx)
- [Apostate release manifest](https://github.com/heretic-tech/apostate/blob/main/python/apostate/assets/release-manifest.json)
