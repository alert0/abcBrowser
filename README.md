# abcBrowser

abcBrowser 是浏览器内核集成与桌面管理器项目，目标是复用 Prism Browser Community 的桌面管理能力，并将运行时适配为 Apostate。

## 文档

- [Prism Browser Community × Apostate 内核集成审查报告](docs/architecture/prism-apostate-integration-review.md)
- [Codex 完整开发提示词：本地 Apostate 内核导入与 Windows 桌面版本](docs/development/codex-implementation-prompt.md)

## 当前开发原则

1. 第一阶段只支持 Windows x64。
2. 优先复用成熟的浏览器管理能力，将内核差异封装在独立适配层中。
3. 本地选择已有的 Apostate `chrome.exe` 导入，不要求用户下载内核；必须复制并验证完整运行目录，不能只复制 exe。
4. 对每项指纹配置区分“界面可设置”与“内核确实支持并已验证”。
5. 测试结果必须记录实际执行环境和证据；静态审查、代码提交和 CI 配置本身都不等于运行验收通过。
6. 不将用户内核、浏览器用户数据、Cookie、密码或代理凭据提交到 Git。

## 当前状态

仓库已包含架构审查报告和完整 Codex 实施提示词。它们是开发依据，不代表桌面应用代码集成、构建或运行测试已经完成。
