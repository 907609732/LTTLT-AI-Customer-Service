# AI 开发入口

修改前依次阅读 `docs/CONSTRAINTS.md`、`docs/ARCHITECTURE.md`、`docs/HANDOFF.md`、`docs/LOCAL_INTEGRATION.md` 和相关模块 README；搜索已有实现，检查工作区改动。桌面支持默认本机 Key 和显式托管模式；托管改动先读 MANAGED_SERVICE.md，server 导入例外与原生检查见该目录 AGENTS/CONSTRAINTS。浏览器保持业务只读预览。

- 依赖方向：app → modules → shared。跨模块只引用 index.ts；禁止 shared 引用上层。
- Vue 使用 script setup lang="ts"；不得用 any、ts-ignore、跳过类型检查解决错误。
- 组件不得直接访问网络、持久化、Electron 或 window.yunduoDesktop。使用模块服务与平台适配器。
- 未接入能力必须明确提示，不伪造成功、余额、授权或后台执行状态。
- 注释解释业务约束、公共契约、安全边界和兼容原因；保留旧 CSS 对应的 data-v 属性。
- 新增模块、依赖、IPC、环境变量或架构例外，必须同步更新文档；重要取舍记入 docs/DECISIONS.md。
- 完成前运行 npm run check 和 npm run test:desktop；界面修改检查截图。不得通过覆盖基准图掩盖差异。
- 交接必须记录实际完成范围、验证结果、未解决问题、下一项任务和验收条件。
- 不运行历史还原生成器覆盖维护中的源码。不修改项目之外的原软件或工具。
- vendor/lingtu-runtime 是固定提交的第三方源码例外；升级先核对 PROVENANCE 与哈希清单，运行 npm run check:vendor 和 npm run test:upstream。自有新代码仍必须使用 TypeScript。
- 密钥由用户在桌面设置填写，只在主进程加密保存；自动验证仅使用临时数据与本机模拟模型。平台实店验收与自动测试分开记录。
- AI 发送及日志相关变更先读 docs/RUNTIME_LOGS.md；本机 AI 回复必须逐条明确批准，禁止绕过统一确认门或恢复自动兜底发送。模型上下文调试只保留有界内存，不记请求头或密钥。
- 模型上下文修改先读 docs/CONTEXT_COMPRESSION.md；16K 触发、目标 8K 按明确估算口径执行，禁止静默裁剪系统/受保护近期原文、混用不同店铺摘要或在压缩失败时发送原始超限请求。
