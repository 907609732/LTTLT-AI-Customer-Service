# quality 模块

职责：质检、售后预警和保留的工单数据服务。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：QcReplyPanel、ShopAftersaleWarningView。2026-11-19 用户明确移除“客服工单/工单登记”菜单与独立本机/团队登记页面；`?panel=workorder` 作为旧链接回落店铺列表。本机工单数据、命令、平台工单和辅助中心历史查看/跟进保留，不删除用户记录。

当前业务状态：QcReplyPanel 已接质检和纠错知识；辅助中心仍可查看、更新状态和添加跟进备注。团队工单 API/服务保留给后台数据和后续入口，但不再提供独立登记页面。平台售后执行和平台同步未接入。

2026-11-18 第二轮清理删除无消费者的 `QcReplyPanel` demo 工厂；2026-11-19 删除仅由独立登记页使用的 `ShopWorkOrderPanel`、`TeamWorkOrderPanel` 及其测试入口。

公共装配、增量验证与验收边界见 docs/parallel/team-handoff.md；本窗口不并发修改公共 HANDOFF.md。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。
