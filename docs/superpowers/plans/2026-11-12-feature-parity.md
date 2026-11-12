# 接待功能补齐实施计划

规格：../specs/2026-11-12-feature-parity.md
执行方式：当前隔离worktree逐项实施；分支codex/reception-feature-parity-20261112，基于PR16的5e7d11e。PR16保持原样，新增功能单独交付。

## 文件与步骤
1. tests/desk reply-engine回归先红后绿，修正自动回复时间被误当人工回复导致漏掉在途新问题；保留人工接管和限速规则。跑完整基础检查建立新基线。
2. electron/product-knowledge.cjs实现严格schema/原子存储/导入/中文检索，复用MiniSearch(MIT)和PapaParse(MIT)；tests/product-knowledge.test.mjs验证隔离、导入原子性、损坏文件和中文查询。backend命令与快照接入；StoreManagement添加现有商品区域入口，ProductKnowledge.tsx实现可用编辑/导入/查询；接待与训练检索同源。
3. electron/intent-knowledge.cjs知识包/条目/绑定，复用同一检索和存储基础；IntentKnowledge.tsx接入UX15并保留设计节点。针对问法、商品限制、禁用、跨店隔离与导入测试。
4. ConversationQuality和AuxiliaryCenter纠错面板只执行显式知识写入命令；保存版本校验、来源审计和账号失效处理。
5. electron/model-profiles.cjs及UX17方案界面；真实worker getConfig按店铺应用绑定规则。全局旧规则向后兼容。
6-13. 按规格逐项补独立任务brief与红绿测试。现成routing/welcome配置只适配必要提交，不能整分支覆盖PR16新发送与账号逻辑。平台动作通过能力协商与确认回显逐步开放。

## 每项交付门槛
类型检查、针对性单元测试、完整根/引擎测试与build；UI改动跑浏览器交互，主进程改动跑隔离Electron集成。记录可运行与尚待真实平台验收的边界。云端检查和源码运行同批提交，未合并/未发布前不声明正式上线。

## 复用依据
- 现有Config、StoreRegistry、AiClient、ReplyEngine、atomic JSON、backend snapshot/commands。
- MiniSearch https://github.com/lucaong/minisearch （MIT，Node/浏览器，支持自定义中文tokenizer）；PapaParse https://github.com/mholt/PapaParse （MIT，CSV解析不自行重写）。
- 跨平台SDK与媒体/转接能力将在各自任务开始前核对官方文档、许可证和实际登录环境。
