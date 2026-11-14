# knowledge 模块

职责：意图、知识、训练、模型与禁用词界面。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：ShopIntentPanel、ShopIntentLearnPanel、ShopTrainingPanel、TrainingCorrectModal、ShopAiCustomPanel、ShopKbPanel、ShopBannedWordPanel、IntentEditorModal、ExampleDialog、ModelSwitchModal。

当前业务状态：ShopIntentPanel、ShopAiCustomPanel、ShopBannedWordPanel、ShopTrainingPanel 已接意图知识、规则方案、禁用词和训练。ShopIntentLearnPanel 可选择本机已有资料、平台商品和平台聊天；本机来源仍复用商品规格、当前会话快照及明确“问：/答：”文本。平台来源经过可注入端口读取实际平台资料，任务、范围、游标、候选和审核记录持久化。两类来源均需人工确认后新增停用知识包。ShopKbPanel 录入本店指定商品的尺码规格，经过相同预览确认入库。来源审计以停用条目随包持久化并随 JSON 导出，不参与检索；意图编辑器只读展示并强制保持该条目停用。审核后在意图知识页显式启用知识包。

候选只整理已实际取得的文字，不运行模型，不证明事实正确。本机商品仅预览第一页最多 100 条，本机聊天最多 100 组相邻买家/客服纯文字，这些快照不能冒充平台主动采集。平台来源逐页记录实际可访问范围，达到上限、平台总数未覆盖或分页失败均明确为部分范围；读完平台声明范围也不代表平台全部资料。聊天必须显式选择北京时间起止日期，媒体和非相邻买家/客服回复不会被猜成问答。PDF/Word/OCR、任意文档智能总结、跨店尺码共用、商品互斥绑定及无人审核自动启用仍未接入。来源容量受上游 4000 字答案限制，超限拒绝而不截断。原文与人工修改结果同时保留；来源审计是可维护的本机记录，不是防篡改日志。

本机领域逻辑见 learning.ts，现有命令适配与重复检查见 services.ts。平台契约见 `src/shared/contracts/platform-learning.ts`，主进程工厂见 `electron/platform-learning-service.ts`。传入当前账号业务目录后，服务以临时文件、flush 和 rename 保存 `platform-learning.json`，最多保留 100 个任务和 10000 个候选，不静默淘汰审核来源。任务与去重指纹绑定本地店铺、平台账号及平台店铺身份；每次采集和入库前后均检查当前工作区租约和平台身份。重启未完成任务暂停，关闭服务取消在途读取并保留暂停进度，恢复必须人工操作；取消或切换后的迟到页面不会入库。磁盘写入失败停止任务，游标留在上次成功页。

主进程 `PlatformLearningPort` 提供 `assertActive/identity/collectProducts/collectChats/listPacks/savePack`。采集端口只接受已验证身份、范围、游标和 AbortSignal，必须返回真实页面身份、资料、下一游标、耗尽标识、采集时间及准确范围；不能用本机历史快照实现平台端口。知识写入复用上游意图包服务，不新增检索实现。审核前写入意图，保存后才记为已入库；提交后响应中断时，下次重试先核对停用来源审计，避免重复创建。

app 从公开 index 导入 `platformLearningTransportKey` 与 `PlatformLearningTransport` 并注入受限适配器。组件只调用该 transport，不读 Electron、网络或文件；固定 IPC、发送来源校验及 workspace 生命周期由公共装配维护。可选 `openSource` 只允许本店平台商品/聊天这两个来源，页面提供“打开平台原页”供人工验证和范围核对，不接受 URL。没有注入时明确显示服务未就绪。页面恢复任务不会自动继续，进度刷新保留人工编辑草稿；账号或店铺变化立即清理页面候选。此模块没有新增依赖。

拼多多采集实现见 `electron/pdd-learning-provider.ts`：复用 `assistPartition` 与已登录分区，独立窗口仅允许拼多多商家同源导航，阻止任意弹窗；身份读取复用固定 vendor 的 `readIdentity`/身份脚本，软件账号和真实客服 ID 共同构成任务账号指纹。商品列表的 TAB、goods-name/goods-id、分离表头/数据表和 PGT 结构已按实页核对，原生查询、状态切换和翻页复用共享 `createAssistQueryMonitor`，不猜私有 HTTP，不读取 Cookie、请求头或整页业务状态。只整理列表实际可见名称、价格、库存和状态，不填造详情或规格。尚不可读的结构、分页和验证码均停止并保留错误，错误时显示独立采集窗口供核对。

聊天来源读取真实 `/mms-chat/search` 后台，使用原生 RPR 日历确认起止日期和“全部”客服后查询。当前实页只允许近30天有效日期，超出平台禁用范围明确拒绝，不回退待回会话或本机归档。一次采集页对应后台消费者列表的一页；消费者列表的左侧分页与每个会话消息的右侧分页分别核对和点击，消息按真实 ID 合并，不把首次20条当成全部历史。`electron/platform-learning-chat.ts` 复用 [Electron Debugger 官方接口](https://www.electronjs.org/docs/latest/api/debugger) 在自有学习窗口观察已验证的 `getMessagesUsers/getMessages` 原生响应，仅允许相同源与固定路径，限制响应为 1 MiB，投影店铺/消费者 ID、消息 ID、时间、角色方向与平台总数。正文只从实际消息 DOM 读取，不重放平台 HTTP、读取请求头或持久化原始响应。每行 DOM 消息 ID 与原生元数据逐条核对，并按平台 `total` 检查消息覆盖和末页控制；每会话最多确认50次后续消息页，仍有未覆盖消息或原页无法继续加载时保留部分范围，不冒充完整历史。每页原始范围随候选保存，较早页的限制不会被末页成功掩盖；未单独记录原始页码的旧候选不冒用任务的最后页面作为来源。系统事件和媒体只参与范围核对，不被编造为问答。

本轮增量验证覆盖 platform-learning-service、platform-learning-provider、platform-learning-chat、platform-learning-chat-dom、platform-learning-ui 及既有 knowledge-learning 三个文件。夹具验证持久化、原生观察边界和交互，不能作为真实平台采集验收。实页已核对商品 DOM/分页、聊天日期/消费者分页及原生消息总数/ID 的对应结构；工厂、IPC 和 UI 的实际采集仍须在整合后的原生应用验收。原生验收需从实店平台读取新资料，暂停/退出重启、核对来源及范围，保存为停用包，再显式启用并在训练场验证召回；同店切换平台账号后旧任务应拒绝继续和入库。并行开发期间不修改公共 HANDOFF.md。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。
