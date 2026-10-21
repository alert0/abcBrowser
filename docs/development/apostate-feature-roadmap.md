# Apostate 专属能力接入路线图

## 原则

abcBrowser 必须把 Apostate 当作具有原生指纹组合能力的 Chromium 内核，而不是普通 Chromium 加启动参数。启动参数、内核组合报告和网页运行时暴露值是不同证据，不能互相替代。

## 本次接入

| 能力 | 状态 | 规则 |
| --- | --- | --- |
| Host Mode | 已接入代码 | 使用 `--fingerprint=host`；不叠加种子、平台、anchor 或逐字段覆盖 |
| Seed composition | 已接入代码 | 使用可复现 seed；同一宿主 CPU 家族内复现 |
| GPU family anchor | 已接入代码 | 使用官方 family ID；auto 交回内核按种子选择 |
| GPU renderer | 已接入代码 | 可选传入 `--fingerprint-gpu-renderer`；内核按当前 family 校验 |
| Device memory | 已接入代码 | 使用 GiB 参数并限制在宿主物理内存范围内 |
| CPU threads | 已接入代码 | 启动参数不超过宿主可用逻辑核心数 |
| Canvas/WebGL noise | 已接入代码 | 默认关闭；只作为可选读取噪声，不能宣称提高隐身能力 |
| Fingerprint explain | 已接入代码 | 诊断中显示 `--fingerprint-explain` 输出及 limitations |
| Locale/timezone | 已接入代码 | 组合模式使用官方 locale/timezone switches；不宣称 Geolocation API 已模拟 |
| WebRTC UDP | 已接入代码 | `proxy_only` 使用 `--fingerprint-webrtc-udp=block`；不静默映射未验证的 `public_only` |
| Custom Profile v3 | 已接入代码 | 使用固定的官方 schema 快照校验 JSON；base64 传入 `--apostate-profile`；不与 seed 或逐字段参数混用 |
| Runtime acceptance | 待完成 | 用真实 Apostate 内核验证 navigator、语言、时区、CPU、内存、屏幕、WebGL/WebGPU、Canvas 和 WebRTC |

## 下一阶段：真实内核验收

Apostate 的 `--apostate-profile` 已接入代码：它接受 base64 编码的 JSON，不是文件路径。自定义 profile 替代种子组合；缺失字段继承宿主值。当前限制 JSON 为 12 KiB，避免 Windows 命令行长度问题。接下来必须在真实内核中验收：

1. 验证 schema 校验覆盖当前官方 v3 schema 的所有约束，并在上游 schema 更新时重新生成和审查快照。
2. 在 Windows x64 上分别验收 host mode、seed mode 和 authored profile mode 的参数互斥。
3. 用真实内核检查 navigator、Client Hints、CPU、内存、屏幕、locale/timezone、WebGL/WebGPU、Canvas 和 WebRTC。
4. 验证 authored profile 未填写的字段确实继承宿主值；schema 通过不等于与宿主 GPU、字体、媒体设备等所有表面一致。
5. 记录 PASS、FAIL、BLOCKED、NOT RUN、内核版本和关键运行日志。

## 不应接入的伪能力

- 不透传旧 Prism 的 brand version、platform version、数字 GPU bucket、render identity 和 selective spoofing 开关。
- 不把代理 GeoIP 坐标当成浏览器 Geolocation API 模拟。
- 不将内核启动成功或 explain 输出单独作为网页指纹一致性通过的证据。
- 不把可选噪声开关宣传成通用反检测保证；它可能被专门测试识别。

## 官方参考

- [Apostate switches](https://github.com/heretic-tech/apostate/blob/ac05908a48195dd2ff463b9a7063f327811faad5/docs/reference/switches.mdx)
- [Apostate profile schema](https://github.com/heretic-tech/apostate/blob/ac05908a48195dd2ff463b9a7063f327811faad5/docs/reference/profile-schema.mdx)
- [Apostate GPU models](https://github.com/heretic-tech/apostate/blob/ac05908a48195dd2ff463b9a7063f327811faad5/docs/reference/gpu-models.mdx)
- [Apostate custom profiles](https://github.com/heretic-tech/apostate/blob/ac05908a48195dd2ff463b9a7063f327811faad5/docs/guides/custom-profiles.mdx)
