# reception 模块

职责：转人工、进店欢迎、自动操作与图片识别配置。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：ShopOpsPanel、TransferSettings、WelcomeSettings、AutoSettings、ImageRecognizeSettings。

当前业务状态：ShopOpsPanel 已接分店/全局人工处理关键词、文字欢迎、全局超时兜底和每店识图设置。旧子组件保留为还原参考；平台自动转客服、媒体欢迎与其他自动操作未接入。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。

## 2026-11-14 接待事件与审批调度

新增 electron/reception-automation-runtime.ts / reception-automation-storage.ts：接收可信主进程访客、未付款订单及转接请求事实，匹配独立规则，生成 scheduler 中逐条待提交确认的意图。最多一条欢迎文字和四条媒体；事件有时效检查、跨重启24小时去重。没有发送或批准接口。平台访客源、媒体确认基线、未付款订单事实和实际客服名单尚未验证，生产能力维持 blocked。规则可通过 createFileReceptionAutomation({ directory, scheduler }) 在本工作区持久化。

定时任务界面已接模块服务，公共生命周期/IPC由统筹装配，见 docs/parallel/reception-scheduler-handoff.md；本次没有修改公共 HANDOFF。
