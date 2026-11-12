# reception 模块

职责：转人工、进店欢迎、自动操作与图片识别配置。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：ShopOpsPanel、TransferSettings、WelcomeSettings、AutoSettings、ImageRecognizeSettings。

当前业务状态：ShopOpsPanel 已接分店/全局人工处理关键词、文字欢迎、全局超时兜底和每店识图设置。旧子组件保留为还原参考；平台自动转客服、媒体欢迎与其他自动操作未接入。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。
