# 拼多多 AI 回复初步实现：合并说明

UI 框架使用云朵客服的。请后续 AI 根据目标项目决定合并方式：只需要功能时，UI 框架不用合并；如果想保留这个 UI，就直接把整个工程代码合并接入。

## 分支组织和启动

本分支在仓库根目录的 `yunduo-ui/` 提供独立 Vue 3 + TypeScript + Electron 工程，不覆盖原 React 工程。进入该目录运行 `npm ci`、`npm run electron:dev`。依赖版本和锁文件必须一起保留；不要把两个工程的 package.json 直接拼接。

开始迁移前阅读本工程 AGENTS.md、docs/CONSTRAINTS.md、ARCHITECTURE.md、HANDOFF.md 及目标工程的开发约束。上游复用来源、固定提交和本地补丁见 vendor/lingtu-runtime/PROVENANCE.md、source-files.json；保留许可证与来源说明。

## 只合并功能，保留目标项目 UI

1. 先检查目标分支已有 PR18 功能，避免复制一套重复后端。以 vendor 的固定提交及补丁说明为参考，逐项迁移差异，不用整个旧 vendor 覆盖更新后的目标源码。
2. 本机模型配置、平台宿主和服务装配参考 electron/local-runtime.ts。密钥由主进程加密保存，不能进入渲染层、日志或仓库。
3. 逐条发送确认与日志参考 electron/review-console.ts、message-diagnostics.ts、conversation-review.ts，以及 shared/contracts/review.ts。根据目标 UI 实现日志入口和确认界面，不依赖直接复制 Vue 组件。
4. 拼多多网页逐字输入与单次按钮发送参考 electron/dom-text-adapter.ts 和 vendor 中 pdd-web-hook.js 的已记录补丁。不要改成系统鼠标、自动回车或未经确认直接发送。
5. 上下文修复参考 electron/conversation-context.ts：按 storeId + uid 合并本机归档、可读平台历史和当前消息，不提前截成 20 条。统一接入 context-compression.ts，16K 触发、8K 目标；保留实际客服回复，不加入未确认候选。
6. 回复间隔设置参考 settings 模块及后端 REPLY_PACING 受限命令，默认 60 秒，可设 0～3600 秒。迁移时同时接上输入校验、旧值冲突检查和逐条消息未回复原因。

组件调用只能经过服务/平台适配层，不直接访问 IPC、网络或持久化。引擎注入点、类型、preload 白名单、运行时校验和回归测试应作为一个完整流程迁移，不能只复制界面或 hook。

## 采用云朵 UI

完整保留 yunduo-ui 工程的 src、electron、public、scripts、tests、vendor、配置、锁文件和文档，从本目录独立启动。确认功能与视觉验收后，再单独决定是否替换仓库默认启动入口；本分支没有修改原项目入口。

## 验收和已知范围

- 在 yunduo-ui 内运行 npm run check 和 npm run test:desktop；合并功能到目标工程时，也必须运行目标项目原有检查。
- 核对平台历史接口不可用仍携带已采集聊天、跨店铺买家隔离、16K/8K 压缩、生成耗时、未调用 AI 的原因、确认前零发送、批准后单次发送，以及新消息/取消/停 AI 不发送。
- 自动测试使用合成数据和本机模拟模型。已有结果：46 项单元、229 项上游回归、63 项桌面检查通过，详见 VALIDATION.md；不代表所有真实平台已验收。
- 本地归档每会话最多 100 条；软件从未采集的历史无法补回。账号托管、支付、安装包签名、自动更新仍未交付。
- 不提交 node_modules、构建产物、测试截图/日志、真实店铺会话、用户密钥或本机配置。用户运行数据留在项目外的本机数据目录。
