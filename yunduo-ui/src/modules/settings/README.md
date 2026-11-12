# settings 模块

职责：设置与软件偏好。

SettingsView 新增 AI 回复间隔表单：当前保存值、0～3600 整数秒、默认 60，0 关闭该间隔；独立保存，不触碰模型 Key，后端校验旧值防并发覆盖。见 docs/MESSAGE_AI_STATUS.md。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：SettingsView、GeneralPanel。

当前业务状态：SettingsView 已接服务商预设、自定义兼容接口、系统加密 Key 存储与连接测试。GeneralPanel 保留为未接线的旧还原视图。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。
