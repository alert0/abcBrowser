# abcBrowser Apostate 适配层审计与本地真实验收

日期：2026-10-21（Asia/Shanghai）。分支：`feature/apostate-local-kernel`。

## 结论与边界

本次使用用户已经导入的 Windows x64 Apostate `155.0.8059.31`，原地执行有界面浏览器测试。没有下载替代内核，没有修改内核、任何 manifest、编译配置或内核打包流程。用户的浏览器环境和代理配置未被测试脚本覆盖；每个测试使用独立临时目录、仅监听 loopback 的探针与随机 CDP 端口。

完整套件 **208 项单元测试通过、2 项跳过、0 项失败**；类型检查及应用构建通过。真实验收发现 **Custom Profile 省略语言时未继承 Host 语言**；此项保留 FAIL，不能宣称全面验收通过。公共网络 WebRTC 泄漏、代理 UDP/TURN 路径缺少充分证据，保留 UNVERIFIED。只进行适配层、验证及验收工作，未开发其他功能。

Windows 电脑控制实际读到 Prism Browser：内核显示已连接，用户环境显示已关闭。随后通过其已导入二进制运行独立验收；没有将普通 Google Chrome 的结果当作 Apostate 证据。

## 官方语义与本次修复

依据固定版本 [switches](https://github.com/heretic-tech/apostate/blob/v0.5.1/docs/reference/switches.mdx)、[profile schema](https://github.com/heretic-tech/apostate/blob/v0.5.1/config/profile.schema.json) 与实际输出：

| 问题 | abcBrowser 处理 |
| --- | --- |
| 旧 Prism GPU bucket 算法改写 Seed | Apostate 启动使用原始 Seed，不再套用旧 bucket 模数；明确旧 metadata 不证明内核 GPU 型号 |
| Seed=0 被内核解释为 Host | Seed 模式保存和启动均拒绝 0；Host/Custom 中不使用该 Seed |
| Host/Custom 静默忽略 `public_only` | 三种模式一致拒绝；`proxy_only` 在三种模式均明确映射 `block`，`default` 不附加策略参数 |
| 小数宿主 GiB 会生成内核不接受的小数参数 | Seed 内存按宿主整 GiB 保守限制；Custom 按物理字节限制；未传宿主选项也读取真实资源 |
| 宿主快照强制最少 2 核、最多 64 核 | 移除虚构下限/截断，保留实际 CPU 与内存精度 |
| UI language 与语言列表首项矛盾 | 启动时拒绝；不再依赖对 persona 无效的 `--lang`；拒绝无效语言列表、时区、数值、GPU 家族/renderer 组合 |
| 窗口大于声称屏幕 | 在启动前明确拒绝；Custom 仅对其显式屏幕维度检查 |
| JSON schema property lookup 读取原型属性 | 只允许 schema 自有属性；`constructor` / `__proto__` / `toString` 不再绕过 unknown-key 检查 |
| 空对象或仅 provenance 不能可靠代表设备 | abcBrowser 明确拒绝这类 Custom 配置；这是应用层比官方 schema 更严格的约束 |
| Explain 能力声明过宽 | 明确 Custom 不能依赖 Explain 输出/退出，使用 API；提示实测语言继承例外 |
| 旧验收错误期待原始超宿主参数 clamp、Custom+Seed 拒绝 | 修正为内核拒绝超限逐字段参数；Custom 原生优先，保存完整参数与 stderr；不再以 Custom Explain 超时当作模式冲突证明 |
| 噪声探针只绘制纯色 | 使用边缘/文字或三角形，避免纯色未改变就误报噪声失败 |

**兼容性影响：** 过去已使用旧 bucket 改写的环境，改用原始 Seed 后身份可能改变。本次没有批量迁移或修改用户保存的 Seed。旧 `effectiveFingerprintSeed` 仅保留作遗留工具，Apostate 不再调用；硬件模板名称不等于真实 GPU 型号，精确型号须指定合法 renderer 并实测。

## 模式互斥与优先级矩阵

Custom JSON 非空且有效时是明确的模式选择（编辑器显示提示），优先于硬件模板；否则 hostMatched 模板选择 Host，其余选择 Seed。非活动模式的字段不编码进启动参数。这与内核设备 Profile 优先语义一致；不向内核发送含糊的组合让其静默决定。

| 输入组合 | 应用输出/结果 | 覆盖 |
| --- | --- | --- |
| Seed + 合法逐字段配置 | 一个 `--fingerprint=原始种子`，平台/CPU/内存/屏幕/locale/timezone/GPU 明确映射 | 单测及真实 API |
| Host + 遗留 Seed/逐字段值/noise | 仅 `--fingerprint=host`，不附加这些指纹覆盖 | 单测及 Host Explain/API |
| Custom + Seed/逐字段值/noise | 仅 `--apostate-profile=base64(UTF-8 JSON)`；遗漏字段不从 Seed 补齐 | 单测及真实 API |
| Custom + Host 模板 + Seed=0 | 明确选择 Custom，仅发送 Profile | 单测 |
| 三种模式 × `default` / `proxy_only` | 6 组均验证模式参数唯一；仅后者发送 `--fingerprint-webrtc-udp=block` | 单测 |
| 三种模式 × `public_only` | 拒绝；不能静默忽略 | 单测 |
| Seed=0、无效资源数值、renderer 无固定家族、冲突 locale、超大窗口 | 启动前拒绝 | 单测 |
| 原生 Host + 逐字段覆盖 | 原生 exit 1，与应用主动排除冲突一致 | 原始 stderr |
| 原生 Custom + Seed/Host + 冲突字段 | Profile 胜出，完整 stderr 已保存；本地二进制未观察到官方文档所述的忽略警告，应用正常启动不生成该组合 | 原生 API 对照 |
| 请求资源低于/等于/高于宿主 | 应用上限检查；原始超宿主 CPU/内存参数 exit 1 | 单测及真实 API/拒绝日志 |

官方 schema 文件本次未改动。单测还覆盖嵌套类型、未知属性、const、exclusiveMinimum、contains、12 KiB 长度限制、UTF-8 base64 与未显式字段不被补值。

## 环境和证据

Windows `10.0.26300` x64，AMD Ryzen 7 5800，16 逻辑处理器，物理内存 `42,806,288,384` bytes（约 39.866 GiB）。Host API：16 核、deviceMemory=32、1680×1050、zh-CN / zh、Asia/Shanghai，WebGL AMD Radeon R7 200 Series。

本地内核 `chrome.exe` SHA-256：`9943a6252e1f540e879805209d844a4110fa7edc476dc50091fdf27740f609d1`。其来源是用户此前导入的 `local-build`；不能据此宣称等同 GitHub 官方 ZIP 或证明上游来源。Explain 实际返回 Chromium `155.0.8059.31`、schema 3、catalogue v2。

- [首次探针诊断](evidence/apostate-local-20261021/evidence.json)：初始 CDP context 在首次导航提交时销毁，API 项为 BLOCKED，属于测试等待逻辑问题；已修复为等待探针 document ready。
- [首次完成的有界面实测](evidence/apostate-local-20261021-ready/evidence.json)：保留真实语言继承失败，未覆写。
- [最终扩展复测](evidence/apostate-local-20261021-final/evidence.json)：64 PASS、2 FAIL（同一语言继承问题的两个 API）、2 UNVERIFIED、0 BLOCKED。各 case 保存 `.arguments.json`、原始 `.stdout.txt` / `.stderr.txt`、结构化 `.json` 与 `.png` 截图。`requested` 与 `effectiveArguments` 可逐项比对，资源 clamp 的输入与实际 API 值均保留。完整应用代码差异见同目录 `abcBrowser.patch`。
- 单元测试 JSON 见 `evidence/apostate-local-20261021-ready/unit-tests-final.json`；测试前新增用例复现 11 项失败，修复后再运行完整套件。

## 实际结果

| 检查 | 状态 | 直接证据/限制 |
| --- | --- | --- |
| Host / Seed Explain | PASS | 原始 composition disabled、seed 42、CPU/memory/screen/locale/timezone 命令行覆盖行与 limitations |
| Host CPU/内存/GPU/屏幕/语言/时区读回 | PASS | Host API JSON，CPU 与宿主快照一致；纯 Host 不包含 Seed/逐字段覆盖 |
| Seed CPU=2、memory=2、1280×900、en-GB/en、Europe/London | PASS | 页面 API、实际 Accept-Language 请求头及截图 |
| Custom 显式同组配置 | PASS | 页面 API、实际请求头及截图 |
| CPU 及 Custom 内存宿主上限 | PASS | 超宿主请求生成安全参数；页面 CPU=16、Custom memory bucket=32 与 Host 一致 |
| GPU 家族与精确 renderer | PASS | Intel UHD Graphics 630 完整 renderer 由 WebGL 实际返回；未把参数出现当成已生效 |
| Canvas 绘制与可选噪声 | PASS | 正常 PNG 读取；相同输入/Seed 开启噪声后边缘图像 hash 改变 |
| 重复 Seed | PASS | CPU、内存、屏幕、locale、timezone、WebGL、Canvas hash 重复一致 |
| 改变 Seed | PASS | 本机 42/43 WebGL 身份有变化；不要求所有显式固定值改变 |
| Partial Custom 继承 CPU 以外的内存/平台/UA/屏幕/时区/WebGL/Canvas | PASS | 与 Host API 基线逐项比较 |
| Partial Custom 继承 language/languages | **FAIL** | Host 为 zh-CN / [zh-CN,zh]；只写 CPU 的 Custom 返回 en-US / [en-US,en]；是此现有二进制可复现行为，保留证据，不改内核 |
| WebRTC loopback STUN 对照 | UNVERIFIED | `default` 对照与 `block` 均收到 0 个 STUN 请求；不能据此证明 block 工作 |
| 公网 WebRTC 无泄漏、代理 UDP/TURN | UNVERIFIED | 缺少受控外部服务/网络路径，未向公共检测网站传指纹或 STUN 数据 |
| 全部模式与公网一致性最终验收 | **未通过** | 上述 FAIL/UNVERIFIED 未解决；不能标记全绿 |

## 本地复现与 CI

依赖已就绪时执行（直接用已存在、可运行的二进制）：

```powershell
npm run typecheck
npx --no-install vitest run --fileParallelism=false --pool=threads --maxWorkers=1
node tools/apostate-runtime-acceptance/local.mjs --executable "C:\path\to\existing\chrome.exe" --output "docs/testing/evidence/local-run"
```

默认有界面，`--headless` 仅为额外对照。退出码非零代表存在 FAIL 或 BLOCKED；UNVERIFIED 必须逐项人工读报告，不能等价通过。脚本只清理其自行启动的 PID 树，保留独立临时 profile 便于诊断；不结束用户现有浏览器。

本机完整套件需要 `ELECTRON_OVERRIDE_DIST_PATH` 指向已存在的 Electron 运行时，否则当前不完整的新 Electron 依赖会尝试在线下载并卡住。此次使用原先运行 Prism 的 Electron dist，不修改 Apostate。

既有 [Windows build workflow](https://github.com/alert0/abcBrowser/actions/workflows/windows.yml) 与 [官方 ZIP runtime workflow](https://github.com/alert0/abcBrowser/actions/workflows/apostate-runtime-acceptance.yml) 分开判断。旧 CI 报告见 [历史记录](apostate-runtime-acceptance.md)。官方 ZIP 的 SxS 启动失败不能否定本地已导入二进制的上述实测，也不能由本机可运行反推官方 ZIP 已修复。本次未修改 CI 的内核发布/打包方式。

代码与证据提交：`2c62372649ecc176fd672a002d1881b82e740aa3`。本地完整测试为 208 PASS / 2 skipped，build/typecheck 通过。最终 evidence 中的 sourceCommit 是运行时基线，dirtyPaths 与代码 diff 对应当时尚未提交的本次修改，避免冒充已提交版本的干净运行。

推送 **BLOCKED**：Git Credential Manager 等待凭据，停止等待后以禁止交互方式重试，明确返回 `fatal: Cannot prompt because user interactivity has been disabled` / `unable to get password from user`。远端分支仍为 `a9dfaeb29e0bff4f8a520e214e8ffcfdbb8eadf9`，本次新 CI 未运行，不能报告通过。身份认证恢复后可执行 `git push origin feature/apostate-local-kernel`，再查看上述两个 workflow。历史 [Windows CI 成功](https://github.com/alert0/abcBrowser/actions/runs/39550870924) 仅属于 `a9dfaeb`；[历史官方 ZIP 启动失败](https://github.com/alert0/abcBrowser/actions/runs/39550166007) 属于 `4db9f08`，均非本次代码的新结果。

## abcBrowser 修改文件

- `src/main/engines/apostate/adapter.ts`、`adapter.test.ts`、`capabilities.ts`、`types.ts`：参数、边界、互斥、能力描述与回归测试。
- `src/main/host-hardware.ts`、`host-hardware.test.ts`：真实宿主资源精度及单核/高核数测试。
- `src/shared/apostate-profile-validation.ts`、对应 `.test.ts`：schema 属性查找与空设备配置拒绝。
- `src/shared/validation.ts`、对应 `.test.ts`：Seed=0 在模式间的保存约束。
- `src/shared/hardware-profiles.ts`、`src/renderer/src/ProfileEditor.tsx`：遗留 GPU metadata/精确型号声明及 Custom 语言限制提示。
- `tools/apostate-runtime-acceptance/local.mjs`、`run.ps1`：现有本地二进制验收及旧脚本语义纠正。
- 本报告与 `docs/testing/evidence/`：原始输出、配置/代码差异、环境、测试 JSON 和截图。

`src/main/launch-args.ts` 是对 adapter 的薄委托，已通过该入口执行真实验收，无需改动。`src/shared/apostate-profile.schema.json` 保持原样；schema 本身允许空对象，而应用层为避免模式歧义明确收紧。
