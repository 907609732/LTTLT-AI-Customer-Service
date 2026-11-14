# workbench 模块

职责：工作台、快捷回复和定时任务界面。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：DashboardView、EnvHealthBanner、StoreWebWorkspace、QuickReplyDialog、ScheduledTasksDialog、RuntimeDownloadToast、UpdateAvailableDialog、UpdateDownloadDialog。

当前业务状态：DashboardView 已接本机店铺概览与添加入口。QuickReplyDialog 已接 80 条内置通用话术，支持搜索、场景筛选、适用条件和显式复制，不直接发送。数据与检索复用 shared/customer-service，复制通过模块服务和受控平台适配器。自定义话术持久化仍未接入。ScheduledTasksDialog 已实现任务编辑、启停、删除、执行记录和取消，经模块 service 使用受控 scheduler 桥；一次、每日 IANA 时区和分钟间隔到点只建立待提交确认意图，未具备平台能力时明确 blocked。公共主进程生命周期与 preload 装配由统筹对话负责；缺少桥接时只显示不可用。详见根目录 docs/GENERIC_PHRASES.md。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。

本轮调度接口与真实未验收项见 docs/parallel/reception-scheduler-handoff.md。
