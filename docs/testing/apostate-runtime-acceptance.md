# Apostate v0.5.1 真实内核验收

更新日期：2026-10-21
目标分支：`feature/apostate-local-kernel`
本机复现基线：`78f074730e433ea3d03f3a2c84f29cdd54e6cc90`
本次代码/CI commit：`4db9f08b9de1b41d95412c496327a70f69f11fd6`  
本地提交备份：`codex/backup-feature-apostate-local-kernel-20261021-da5dbdc`（`da5dbdc6f4abe05f586abd37fad822006e31b561`）  
原基线备份：`codex/backup-feature-apostate-local-kernel-20261021-78f0747`

## 结论

真实 Windows x64 启动仍被上游发布包阻塞，不能报告指纹验收通过。GitHub 官方发布 ZIP 的 SHA-256 与 v0.5.1 release digest 一致，但包内缺少 `155.0.8059.31.manifest`。同一 ZIP 中的 `chrome.exe` 嵌入式 manifest 请求 `155.0.8059.31` SxS 程序集；Windows 启动时产生 SideBySide Event ID 33，`chrome.exe --version` 在创建进程阶段失败。

这不是由 VC++ Redistributable 安装码 1638 证明的 CRT 问题：1638 只说明已有另一版本。当前证据指向独立的 Chromium SxS 激活依赖。验收没有改写官方 ZIP，也没有生成或混入其他版本 manifest。要解除阻塞，需要上游发布包含与该二进制匹配的构建产物清单，或采用能产出并保留该清单的正式构建/打包流程。

## 发布包与根因证据

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 官方版本与资产 | Apostate `v0.5.1` / Chromium `155.0.8059.31` | [GitHub Release](https://github.com/heretic-tech/apostate/releases/tag/v0.5.1) |
| 固定 SHA-256 | PASS：`8e55e44fb7f58619461e1d42a947446dcc08a2b46493c420c8e62ae27ab9c7e5` | 与官方 release asset digest 一致；本机对完整 ZIP 重新计算相同 |
| 运行时目录 | PASS：`chrome.exe`、`chrome.dll`、`chrome_elf.dll`、`resources.pak`、`icudtl.dat` 均存在 | 本机展开官方 ZIP 后检查 |
| 外部版本化 manifest | FAIL：ZIP 中没有 `155.0.8059.31.manifest` | ZIP 目录清单及本机验收 JSON |
| 嵌入式 manifest | PASS：`mt.exe` 提取结果请求名称/版本均为 `155.0.8059.31`、类型 `win32`、语言 `*` | `chrome-embedded.manifest` |
| 实际启动 | FAIL：`chrome.exe --version` 因 SideBySide 激活失败 | Windows Application 日志 Event ID 33；缺失程序集同为 `155.0.8059.31` |
| `sxstrace` | UNVERIFIED：当前非提升权限会话无法启动 ETW trace | 保留 `sxstrace-start.txt`；SideBySide 事件日志仍已采集 |

上游 v0.5.1 的 [Windows 构建产物清单](https://github.com/heretic-tech/apostate/blob/v0.5.1/scripts/build.sh)和[发布包 staging 清单](https://github.com/heretic-tech/apostate/blob/v0.5.1/scripts/package-artifact.sh)都没有纳入这个版本化外部 manifest。release 附带的 `.zip.manifest.json` 是资产来源/摘要元数据，不是 Windows SxS loader 所需的程序集 manifest。

本机详细的脱敏摘要位于 [apostate-runtime-acceptance-evidence.json](./apostate-runtime-acceptance-evidence.json)。验收脚本生成的原始证据目录位于 `%TEMP%\apostate-native-acceptance\evidence\20261021T052652Z`；CI 会上传整个 evidence 目录，包括环境信息、ZIP 目录清单、嵌入式 manifest、启动 stdout/stderr、参数（已脱敏）、SideBySide 事件与可用的 sxstrace 文件。

## 代码处理

- Windows 内核导入、激活和完整性检查现在验证 `${ChromiumVersion}.manifest` 与 `chrome_elf.dll` 映射。缺失或身份不匹配时明确拒绝，不合成 manifest，也不启动已知不可用的 runtime。
- 真实运行时验收先核对官方 ZIP digest、布局与外部 manifest，再执行 `chrome.exe --version`；之后才运行 Explain/API 检查。失败时仍写入结构化 evidence 并上传日志。
- Explain 从文档化的 `apostate fingerprint composition` 头部/键值行解析版本、seed、警告与 limitations；没有输出的项目不会根据启动参数冒充已验证。
- 探针记录 UA Client Hints、`navigator.languages`、WebGL、Canvas 像素样本和 ICE candidate 类型，并用仅监听 loopback 的本地 HTTP probe 读取真实请求头。Canvas 正常绘制与噪声是否改变读取结果分开记录。没有受控 STUN/TURN 路径的 WebRTC 外部泄漏结论保持 UNVERIFIED；本次启动失败，因此 HTTP header 也尚无实测值。
- Custom Profile 的 CPU 与内存字段会在编码启动参数前按真实宿主上限 clamp；单元测试覆盖该行为和 Host/Profile 不透传逐字段覆盖参数。

## 模式及运行时验收矩阵

| 模式/表面 | 请求值与预期约束 | 本次结果 |
| --- | --- | --- |
| Host | `--fingerprint=host`；不组合 Seed/逐字段覆盖，页面值应来自本机 | UNVERIFIED：内核未启动 |
| Seed | 固定 seed 42；Windows、CPU=2、memory=2、1024×768、`en-GB`、`Europe/London` | UNVERIFIED：未到 Explain/API 阶段 |
| GPU anchor/renderer | Intel D3D11 anchor 与显式 UHD 630 renderer；必须由 Explain 和 WebGL 读取共同证实 | UNVERIFIED：未到 GPU probe |
| Custom Profile | v3 profile；显式字段按请求生效，遗漏字段继承宿主；CPU/memory 不超过宿主 | UNVERIFIED：真实页面未启动；应用参数 clamp 有单测覆盖但本机依赖未能安装，待 CI 验证 |
| CPU | 低于、等于、高于宿主逻辑核心数时检查 `navigator.hardwareConcurrency` | UNVERIFIED：未运行边界值测试 |
| Device Memory | 区分应用层 host clamp 与 Chromium API bucketing | UNVERIFIED：未读取 `navigator.deviceMemory` |
| Screen / locale / timezone | 检查 `screen`、`navigator.language/languages`、`Intl` timezone | UNVERIFIED：未运行页面 probe |
| HTTP `Accept-Language` | 必须从实际 HTTP 请求头读取，不能用 `navigator.language` 替代 | UNVERIFIED：没有 HTTP 请求证据 |
| WebGL / Canvas | 记录 WebGL vendor/renderer、Canvas data URL 与像素；噪声效果单独比较 | UNVERIFIED：未运行页面 probe |
| WebRTC | 记录 ICE candidate 类型；无受控 STUN/TURN 测试不能证明无公网 UDP 泄漏 | UNVERIFIED：未运行网络 probe |

## CI 与后续条件

本次代码提交 `4db9f08b9de1b41d95412c496327a70f69f11fd6` 的 Windows x64 workflow [#24](https://github.com/alert0/abcBrowser/actions/runs/39550166000) 成功：依赖安装、TypeScript 检查、单元测试、应用构建、Windows x64 打包及构建 artifact 上传全部通过。

同一提交的 [Apostate Runtime Acceptance #5](https://github.com/alert0/abcBrowser/actions/runs/39550166007) 按预期失败：官方 ZIP SHA-256、运行时布局和嵌入式依赖检查通过；ZIP 中版本化外部 manifest 数量为 0；`chrome.exe --version` 仍因 SideBySide 缺少程序集 `155.0.8059.31` 失败。Windows Runner 成功采集并解析 `sxstrace`。Explain 与所有浏览器 API/指纹行为测试因启动失败均标为 UNVERIFIED，没有被记为通过。

Runtime Acceptance 上传的 [完整 evidence artifact](https://github.com/alert0/abcBrowser/actions/runs/39550166007/artifacts/12323326654) 含 14 个文件，大小 17,546 bytes，ZIP SHA-256：`babd2cdccef5284eec18b47e8e8aba8b3e1b6f38ade9f918e9e937ed54ea85fd`。本地原始复现中 `sxstrace` 因未提升权限而 UNVERIFIED；CI artifact 补充了提升 Runner 上的 trace 与解析文本。CI 原始证据中的机器信息与本机不同，详情以 artifact 内的 `environment.json` 为准。

本机 `npm ci` 因已有 Electron 进程占用 `node_modules` 中的 `d3dcompiler_47.dll` 返回 EPERM；没有结束那些进程，也没有删除依赖目录。本地 `npm test` 随后因依赖不完整而无法执行，但干净 Windows Runner 上对应单测、应用构建和打包已全通过。

完整真实验收仍需上游提供包含与 `chrome.exe` 同构建生成的 Windows SxS manifest 的修复包；之后重跑 `--version`、Host/Seed/Custom Profile 浏览器 API、GPU/WebGL/Canvas、HTTP header 和受控 ICE 网络测试。物理 GPU 与可控 STUN/TURN 环境不可用时，对应项目继续标为 BLOCKED/UNVERIFIED。
