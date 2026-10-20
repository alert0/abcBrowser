# abcBrowser

abcBrowser 是浏览器内核集成与桌面管理器项目。

## 文档

- [Prism Browser Community × Apostate 内核集成审查报告](docs/architecture/prism-apostate-integration-review.md)

## 当前开发原则

1. 先验证 Windows x64 内核的实际导入、启动和环境隔离，再开展大规模代码改造。
2. 复用成熟的浏览器管理能力，将内核差异封装在独立适配层中。
3. 对所有内核发行包执行来源校验与 SHA-256 校验。
4. 对每项指纹配置区分“界面可设置”与“内核确实支持并已验证”。
5. 测试结果必须记录实际执行环境和证据；静态审查不得标记为运行验收通过。

## 状态

目前仓库先提交架构审查文档。本文档不代表已完成代码集成或运行测试。
