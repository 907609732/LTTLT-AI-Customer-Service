# AI 开发入口

2026-11-14 最新授权：用户已明确要求建立交付分支并推送/合并到同一仓库 main。本轮允许在本目录初始化 Git、关联 907609732/LTTLT-AI-Customer-Service，按 MAIN_DELIVERY_20261114.md 将本工程直接置于仓库根，保留 Git 历史与现有许可文件，不嵌入旧 React 目录。此前“暂不提交/推送”的限制对本次交付已解除；安装包公开发布、生产部署和真实买家发送仍未授权。

产品名称为“灵兔 AI”，名称与数据兼容规则先读 docs/BRANDING.md。本机品牌改名已获用户授权，包含界面、图片、打包、后台和文档；主目录不移动，既有 userData、安装 appId、登录分区与 IPC 标识按兼容规则保留。本轮提交、推送与 main 合并按最新授权执行，公开发布仍未授权。

当前工作区的实际独立项目根为 `E:\~1awucheng\Plastic SCM\AI电商客服软件\client`；先读 `docs/PROJECT_LAYOUT.md`。`.github`、package.json、src、electron、server、vendor 属于同一个独立工程。不要再将整个 F:\Setupgod 或旧 React 仓库当作本工程，也不要把主工程嵌到旧推送工作区。本轮允许本机维护、品牌改名及已授权的独立根目录交付；后续其他仓库、生产部署和公开发布仍须另行指令。兄弟目录保持原样。

修改前依次阅读 `docs/CONSTRAINTS.md`、`docs/ARCHITECTURE.md`、`docs/HANDOFF.md`、`docs/LOCAL_INTEGRATION.md` 和相关模块 README；搜索已有实现，检查工作区改动。桌面支持默认本机 Key 和显式托管模式；托管改动先读 MANAGED_SERVICE.md，server 导入例外与原生检查见该目录 AGENTS/CONSTRAINTS。浏览器保持业务只读预览。

- 依赖方向：app → modules → shared。跨模块只引用 index.ts；禁止 shared 引用上层。
- Vue 使用 script setup lang="ts"；不得用 any、ts-ignore、跳过类型检查解决错误。
- 组件不得直接访问网络、持久化、Electron 或 window.yunduoDesktop。使用模块服务与平台适配器。
- 未接入能力必须明确提示，不伪造成功、余额、授权或后台执行状态。
- 注释解释业务约束、公共契约、安全边界和兼容原因；保留旧 CSS 对应的 data-v 属性。
- 新增模块、依赖、IPC、环境变量或架构例外，必须同步更新文档；重要取舍记入 docs/DECISIONS.md。
- 验证规则（用户于 2026-11-14 指定）：日常开发只验证本次改动及其直接影响的流程，选择相关测试、检查或截图，不验证未修改且不受影响的部分，不默认运行全量 npm run check、npm run test:desktop 或全量上游测试。界面修改只检查受影响界面；不得通过覆盖基准图掩盖差异。
- 只有打包 Release 时才执行全量验证，包括 npm run check、npm run test:desktop，以及对应 Release 打包和产物验收。日常交接写明实际验证范围与结果，不把局部验证表述为全量通过。此规则优先于项目其他文档中日常开发必须全量验证的旧要求。
- 交接必须记录实际完成范围、验证结果、未解决问题、下一项任务和验收条件。
- 不运行历史还原生成器覆盖维护中的源码。不修改项目之外的原软件或工具。
- vendor/lingtu-runtime 是固定提交的第三方源码例外；升级先核对 PROVENANCE 与哈希清单，运行 npm run check:vendor 和 npm run test:upstream。自有新代码仍必须使用 TypeScript。
- 密钥由用户在桌面设置填写，只在主进程加密保存；自动验证仅使用临时数据与本机模拟模型。平台实店验收与自动测试分开记录。
- AI 发送及日志相关变更先读 docs/RUNTIME_LOGS.md；本机 AI 回复必须逐条明确批准，禁止绕过统一确认门或恢复自动兜底发送。模型上下文调试只保留有界内存，不记请求头或密钥。
- 模型上下文修改先读 docs/CONTEXT_COMPRESSION.md；16K 触发、目标 8K 按明确估算口径执行，禁止静默裁剪系统/受保护近期原文、混用不同店铺摘要或在压缩失败时发送原始超限请求。
