# knowledge 模块

职责：意图、知识、训练、模型与禁用词界面。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：ShopIntentPanel、ShopIntentLearnPanel、ShopTrainingPanel、TrainingCorrectModal、ShopAiCustomPanel、ShopKbPanel、ShopBannedWordPanel、IntentEditorModal、ExampleDialog、ModelSwitchModal。

当前业务状态：ShopIntentPanel、ShopAiCustomPanel、ShopBannedWordPanel、ShopTrainingPanel 已接意图知识、规则方案、禁用词和训练。ShopIntentLearnPanel 复用本机商品规格、当前会话快照及明确“问：/答：”文本生成候选，人工确认后新增停用知识包。ShopKbPanel 录入本店指定商品的尺码规格，经过相同预览确认入库。来源审计以停用条目随包持久化并随 JSON 导出，不参与检索；意图编辑器只读展示并强制保持该条目停用。审核后在意图知识页启用知识包。

候选只整理已存在文字，不运行模型，不代表平台主动采集、完整聊天历史或事实正确。平台采集、PDF/Word/OCR、任意文档智能总结、跨店尺码共用、商品互斥绑定和后台自动学习任务仍未接入。商品仅预览第一页最多 100 条，页面明确实际读取数量；聊天最多 100 组相邻买家/客服纯文字。来源容量受上游 4000 字答案限制，超限拒绝而不截断。原文与人工修改结果同时保留；来源审计是可维护的本机记录，不是防篡改日志。

领域逻辑见 learning.ts，现有命令适配与重复检查见 services.ts；没有新增依赖、IPC、主进程注入或存储文件。增量验证及边界见 docs/parallel/knowledge-handoff.md。并行开发期间不修改公共 HANDOFF.md。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。
