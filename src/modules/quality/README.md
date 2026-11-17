# quality 模块

职责：工单、质检和售后预警界面。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：QcReplyPanel、ShopWorkOrderPanel、ShopAftersaleWarningView。2026-11-17 维护清理删除了仅显示“开发中”的 ShopWipPanel、其 demo 和 `learn/supervise/drill` 面板注册；这三个旧 `?panel=` 键现在回落到店铺列表，真实训练与学习入口仍在 knowledge 的 training/intent 面板。

当前业务状态：ShopWorkOrderPanel、QcReplyPanel 已接本机工单、质检和纠错知识。工单页可切换独立 TeamWorkOrderPanel，团队登记/主管分配/本人处理/跟进由 account 公开团队服务接入服务端，按租户与店铺授权校验；本机模式和未装配传输明确不可用。本机记录不自动迁移团队，平台售后执行和平台同步未接入。

2026-11-18 第二轮清理删除无消费者的 `QcReplyPanel`、`ShopWorkOrderPanel` demo 工厂；真实组件和团队/本机服务入口不变。

公共装配、增量验证与验收边界见 docs/parallel/team-handoff.md；本窗口不并发修改公共 HANDOFF.md。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。
