# auxiliary 模块

职责：辅助中心、会话预览、后台聚合、助手与弹层。

买家消息日志附带逐条 AI 处理状态、调用事实及原因，可跳转请求和显式恢复被暂停会话；历史无证据不能倒推。处理规则见 docs/MESSAGE_AI_STATUS.md。

RuntimeLogsView 是独立日志窗口：已采集的店铺/买家/客服消息、实际模型上下文及候选确认。经模块入口导出，由主进程窗口加载 /logs；状态机、失效和发送闸门在主进程，不允许 UI 自行发送候选文字。见 docs/RUNTIME_LOGS.md。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：AiAssistCenterView、MascotFloatView、SnapOverlayView、ConsultPanel、BackendHubView、HubTabBar、HubWebStage。

当前业务状态：AiAssistCenterView 已接采集会话、选择/定位、人工发送、草稿和恢复本会话 AI。其他聚合/助手还原组件尚未承担真实业务；平台真实性需用户验收。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。
