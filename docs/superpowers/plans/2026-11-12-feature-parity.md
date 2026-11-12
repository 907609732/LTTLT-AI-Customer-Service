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

## Task 3 brief：意图知识包
- 输入：包名、启用状态、店铺ID绑定、可选商品编号绑定；条目含问法、关键词、标准答案、启用状态。
- 输出：严格版本化本地记录、CRUD/JSON预览导入、仅匹配当前店铺/商品的检索；与商品参考一同送入实际回复及训练。
- 不自动向买家发送固定话术，不自动开启AI；模型仍须遵守全局规则。
- RED：跨店隔离、同编号不同店铺、商品限制、禁用/过期版本、坏文件不覆盖；managed transport的实际messages必须出现匹配条目。
- GREEN：服务→backend→UX15；根/引擎/build/浏览器/Electron验证后提交。

## Task 4 brief：人工纠错学习
- 质检详情和辅助中心显式打开纠错面板；选取真实买家消息，编辑标准答案，二次确认后仅保存本店知识。
- 命令携带店铺、顾客、质检记录及版本，校验消息内容/时间仍存在；记录来源审计，重复确认不重复新增。
- 不改平台历史、不自动发送、不解除AI会话限制；账号切换使旧表单失效。
- 测试覆盖错误顾客/版本、重复提交、来源持久化、检索命中及UI明确确认。

## Task 5 brief：店铺模型规则方案
- 复用现有全局规则为默认方案，增加可命名的提示词方案和店铺绑定；不新增密钥副本，也不覆盖托管账号服务端模型授权。
- 实际worker与训练场按当前店铺解析规则；未绑定沿用全局。删除方案须确认并显式解除绑定回全局。
- 严格版本与损坏文件保护；切换账号隔离；不改变AI开关。保持旧save-config UX17兼容。
- RED覆盖多店不同规则、实时绑定/解绑、删除确认、版本/损坏保护，worker/training使用一致。
