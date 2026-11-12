# knowledge 模块

职责：意图、知识、训练、模型与禁用词界面。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：ShopIntentPanel、ShopIntentLearnPanel、ShopTrainingPanel、TrainingCorrectModal、ShopAiCustomPanel、ShopKbPanel、ShopBannedWordPanel、IntentEditorModal、ExampleDialog、ModelSwitchModal。

当前业务状态：ShopIntentPanel、ShopAiCustomPanel、ShopBannedWordPanel、ShopTrainingPanel 已接意图知识、规则方案、禁用词和训练。尺码库、文档/聊天自动转意图等未接入。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。
