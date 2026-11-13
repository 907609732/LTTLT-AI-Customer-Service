# 功能迁移说明（按需参考）

本项目当前独立维护，唯一根目录为 F:\Setupgod\yunduo-ui；日常开发入口见 README.md 和 PROJECT_LAYOUT.md。本文仅供将功能移植到其他工程时参考，不是当前推送、合并或复制整个旧仓库的指令。本轮未经用户审阅，不提交或推送。

## 主项目与启动

package.json、.github、src、electron、server、vendor 均以本目录为根。未来上传独立仓库时，从本目录内容开始，不再嵌套到旧 React 仓库的 yunduo-ui/ 下。进入本目录运行 npm ci、npm run electron:dev。依赖版本和锁文件必须一起保留；不要把其他工程的 package.json 直接拼接。

开始迁移前阅读本工程 AGENTS.md、docs/CONSTRAINTS.md、ARCHITECTURE.md、HANDOFF.md 及目标工程的开发约束。上游复用来源、固定提交和本地补丁见 vendor/lingtu-runtime/PROVENANCE.md、source-files.json；保留许可证与来源说明。

## 只合并功能，保留目标项目 UI

1. 先检查目标分支已有 PR18 功能，避免复制一套重复后端。以 vendor 的固定提交及补丁说明为参考，逐项迁移差异，不用整个旧 vendor 覆盖更新后的目标源码。
2. 本机模型配置、平台宿主和服务装配参考 electron/local-runtime.ts。密钥由主进程加密保存，不能进入渲染层、日志或仓库。
3. 逐条发送确认与日志参考 electron/review-console.ts、message-diagnostics.ts、conversation-review.ts，以及 shared/contracts/review.ts。根据目标 UI 实现日志入口和确认界面，不依赖直接复制 Vue 组件。
4. 拼多多网页逐字输入与单次按钮发送参考 electron/dom-text-adapter.ts 和 vendor 中 pdd-web-hook.js 的已记录补丁。不要改成系统鼠标、自动回车或未经确认直接发送。
5. 上下文修复参考 electron/conversation-context.ts：按 storeId + uid 合并本机归档、可读平台历史和当前消息，不提前截成 20 条。统一接入 context-compression.ts，16K 触发、8K 目标；保留实际客服回复，不加入未确认候选。
6. 回复间隔设置参考 settings 模块及后端 REPLY_PACING 受限命令，默认 60 秒，可设 0～3600 秒。迁移时同时接上输入校验、旧值冲突检查和逐条消息未回复原因。

组件调用只能经过服务/平台适配层，不直接访问 IPC、网络或持久化。引擎注入点、类型、preload 白名单、运行时校验和回归测试应作为一个完整流程迁移，不能只复制界面或 hook。

## 采用灵兔 AI 界面

完整保留本工程的 src、electron、public、server、scripts、tests、vendor、.github、配置、锁文件和文档，从本目录独立启动。仅在用户明确要求迁移时，才与目标项目逐项核对。外层 \_github、历史克隆、原始数据和其他兄弟目录不随本工程复制。

## 验收和已知范围

- 在 yunduo-ui 内运行 npm run check 和 npm run test:desktop；合并功能到目标工程时，也必须运行目标项目原有检查。
- 核对平台历史接口不可用仍携带已采集聊天、跨店铺买家隔离、16K/8K 压缩、生成耗时、未调用 AI 的原因、确认前零发送、批准后单次发送，以及新消息/取消/停 AI 不发送。
- 自动测试使用合成数据和本机模拟模型；实际日期、测试数量及本轮整理结果见 VALIDATION.md。历史云端结果不替代迁移后的重新检查，不代表所有真实平台已验收。
- 本地归档每会话最多 100 条；软件从未采集的历史无法补回。可选托管与无签名打包已接入；支付、安装包签名、自动更新仍未交付。
- 不提交 node_modules、构建产物、测试截图/日志、真实店铺会话、用户密钥或本机配置。用户运行数据留在项目外的本机数据目录。
