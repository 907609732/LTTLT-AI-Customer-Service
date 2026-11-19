# knowledge 模块

2026-11-19 商品资料编辑弹窗：商品行把标题/编号/来源收在同一行，下面只展示分页投影的短文案、最多3张缩略图、审核/草稿计数和学习进度，右侧保留原操作。点击“编辑”进入深炭色居中弹窗（≤980px、`max-height:min(88vh,900px)`），顶部显示图/标题/来源/关闭，正文独立滚动，底部固定取消/保存；左260px图集支持切换和本地加图，右侧编辑当前店铺根商品标题、只读商品ID、手工价格、平台采集价/有效期和备注，全宽文案显示字数，并保留“管理知识点/增加一个知识点”进入原问答编辑器。`product-profile-controller.ts` 只持有该弹窗表单和暂存图；`manager-controller.ts` 仍是店铺/账号租约、路由离开、草稿/审核和刷新生命周期的唯一所有者。按钮使用 `data-testid="product-edit"`/`product-knowledge`，窄屏通过 760px media query 单列。

读取使用 `product-profile` 窄操作：本店展示标题优先取专用手工来源 JSON，回退平台静态/目录标题和共享标题；文案优先已存手工来源，否则平台静态/目录描述；空手工文案保持空，不回落旧平台文案。平台价只投影同店同商品当前根/SKU 的 `kind='platform'` 动态快照中带价格的未清除记录，并按所展示价格的最早采集时间判断过期。列表 SQL 只取最多200字摘要、展示标题和3个图片资产ID，不把来源正文或逐行详情传给渲染层；展示标题参与搜索。保存使用 `product-profile-save`，一次事务提交专用手工来源中的标题、手工价、备注、文案和新增图；binding/canonical 原值不改，binding revision 仅用于身份与并发核对。共享名称/编码仍走原工作区入口。

图片使用主进程原生选择器，渲染层不接触路径：PNG/JPEG/GIF/WebP按字节签名和既有 `@napi-rs/canvas` 解码验证（含像素尺寸/总量上限），单图≤10MB、单次≤8张、合计≤50MB，图集≤8张。成功选图只进入带工作区/店铺/根 binding/双 revision 租约的内存 staging（最多16项、2分钟TTL、单次使用不透明 token），不写业务DB；取消/切店/关闭丢弃，保存成功才由 `KnowledgeRepository.addAsset/saveSource` 与手工资料同事务提交。若事务失败，仅回收这次新建且此前不存在的 content-addressed 附件文件，不删除已有或共享 digest；staged token 在 COMMIT 后才能消费。首次和并发保存都核对 binding revision、手工来源 ID/revision，冲突保留表单和合法暂存；平台快照、身份和原审核条目不被覆写。

手工资料固定使用现有 `sources/source_versions/assets` 机制、`kind='manual'`、标签 `商品手工资料` 和 `lingtu-product-profile-v1` JSON（`src/shared/contracts/knowledge-product-profile.ts`），标题只是其中可选字段，兼容旧来源；因此无需DB迁移，并进入原件/同款/单店备份恢复闭包。详情图集按手工、平台、其他已登记图片的顺序合并且限制为16张，尊重 removed/cleared-source。该来源不参与 `resolve` 接待，也不作为学习素材：商品学习/OCR入口过滤它，运行时 pipeline 对传入该来源直接拒绝。保存失败、重复提交、迟到选图、两店相同商品ID（含同款共享canonical）隔离见 `tests/knowledge-product-profile.test.ts`、`tests/knowledge-product-editor.test.ts` 与 `tests/knowledge-manager.test.ts`；真实主窗口桌面/窄屏入口为 `LINGTU_DESKTOP_CHECKS=business:knowledge-product-editor node scripts/run-desktop.mjs`。

商品复选框始终可用；有选择后才显示全选本页、全选当前筛选（含跨页）、全不选及学习选中商品。批量学习固定使用点击时当前店铺、当前筛选内的精确选中集合，仍经过资料预估与明确确认；商品行的“开始学习”独立限定为该商品，不合并列表勾选范围。列表/筛选/选择/账号/店铺变化后丢弃未完成的批量预览。

2026-11-19：知识库 `#/knowledge` 改为主工作台内容区子路由，与配置中心共用顶栏。正式主进程不再创建知识库独立窗口，原入口和店铺/训练预选继续经过窄桥及工作区校验，`knowledge:navigate` 仅通知主工作台固定目的地。页面显示返回工作台按钮，切换页面先保存草稿；保存失败或当前操作尚未完成时阻止离开。后台任务不随内容区切换取消。独立窗口适配只保留既有隔离验收用途。

2026-11-19：AI训练场并入知识库商品页右侧 tab。训练固定使用知识库当前店铺和可选商品，商品选项由现有 `products` 查询分页读全；商品卡“AI训练场”只切换 tab 并预选本行 `binding.storeId/productId`，发送前不调用模型。配置中心侧栏移除训练场，旧 `?panel=training/sim` 兼容打开当前店铺的训练 tab；`ShopOpsPanel` 与店铺设置助手的旧入口同样直接打开知识库。切店/切商品清空历史并丢弃迟到回复与旧商品列表，图像测试、错误状态和清空历史保留。

2026-11-15：新增独立 `#/knowledge` 管理窗口及SQLite统一审核知识接线，见 [KNOWLEDGE_LIBRARY.md](../../../docs/KNOWLEDGE_LIBRARY.md)。`KnowledgeManagerView` 组合商品卡、草稿编辑器与审核对话框，模块状态在 `manager-controller.ts`；服务经共享窄桥调用。下文旧页面的“启用并保存”不再发布：兼容保存/导入生成草稿，必须进入独立知识库审核。目录优先的拼多多只读采集已注册；专用KnowledgeCatalogDialog显示跨页数量并禁用未核对范围全选。文件导入、图片/扫描件及当前模型学习已通过同一dispatcher接入；每日09:00安静检查、待学箱、CSV/JSON兼容导出以及全库/同款备份恢复已接入；平台采集和导入只记录原料/待审稿，不发布答案。商品内“原始资料”明确提供本商品导入/学习入口；归档聊天选择日期范围、预览实际记录后导入，详见KNOWLEDGE_LIBRARY的当前功能章节。

职责：意图、知识、训练、模型与禁用词界面。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：ShopIntentPanel、ShopIntentLearnPanel、ShopTrainingPanel、TrainingCorrectModal、ShopKbPanel、ShopBannedWordPanel、IntentEditorModal、ExampleDialog、ModelSwitchModal。模型定制独立页面与公开导出已移除，店铺提示词/字数上限统一在店铺基础设置的“客服风格”维护；规则存储和历史方案保留。

当前业务状态：ShopIntentPanel、ShopBannedWordPanel、ShopTrainingPanel 已接意图知识、规则方案、禁用词和训练。ShopIntentLearnPanel 可选择本机已有资料、平台商品和平台聊天；本机来源仍复用商品规格、当前会话快照及明确“问：/答：”文本。平台来源经过可注入端口读取实际平台资料，任务、范围、游标、候选和审核记录持久化。两类来源均需人工确认后新增停用知识包。ShopKbPanel 录入本店指定商品的尺码规格，经过相同预览确认入库。来源审计以停用条目随包持久化并随 JSON 导出，不参与检索；意图编辑器只读展示并强制保持该条目停用。审核后在意图知识页显式启用知识包。

候选只整理已实际取得的文字，不运行模型，不证明事实正确。本机商品仅预览第一页最多 100 条，本机聊天最多 100 组相邻买家/客服纯文字，这些快照不能冒充平台主动采集。平台来源逐页记录实际可访问范围，达到上限、平台总数未覆盖或分页失败均明确为部分范围；读完平台声明范围也不代表平台全部资料。聊天必须显式选择北京时间起止日期，媒体和非相邻买家/客服回复不会被猜成问答。上述旧页面不具备PDF/Word/OCR；新独立知识库已接入文件解析/当前视觉模型及同款共享审核，详见KNOWLEDGE_LIBRARY。无人审核自动启用仍不提供。来源容量受上游 4000 字答案限制，超限拒绝而不截断。原文与人工修改结果同时保留；来源审计是可维护的本机记录，不是防篡改日志。

本机领域逻辑见 learning.ts，现有命令适配与重复检查见 services.ts。平台契约见 `src/shared/contracts/platform-learning.ts`，主进程工厂见 `electron/platform-learning-service.ts`。传入当前账号业务目录后，服务以临时文件、flush 和 rename 保存 `platform-learning.json`，最多保留 100 个任务和 10000 个候选，不静默淘汰审核来源。任务与去重指纹绑定本地店铺、平台账号及平台店铺身份；每次采集和入库前后均检查当前工作区租约和平台身份。重启未完成任务暂停，关闭服务取消在途读取并保留暂停进度，恢复必须人工操作；取消或切换后的迟到页面不会入库。磁盘写入失败停止任务，游标留在上次成功页。

主进程 `PlatformLearningPort` 提供 `assertActive/identity/collectProducts/collectChats/listPacks/savePack`。采集端口只接受已验证身份、范围、游标和 AbortSignal，必须返回真实页面身份、资料、下一游标、耗尽标识、采集时间及准确范围；不能用本机历史快照实现平台端口。知识写入复用上游意图包服务，不新增检索实现。审核前写入意图，保存后才记为已入库；提交后响应中断时，下次重试先核对停用来源审计，避免重复创建。

app 从公开 index 导入 `platformLearningTransportKey` 与 `PlatformLearningTransport` 并注入受限适配器。组件只调用该 transport，不读 Electron、网络或文件；固定 IPC、发送来源校验及 workspace 生命周期由公共装配维护。可选 `openSource` 只允许本店平台商品/聊天这两个来源，页面提供“打开平台原页”供人工验证和范围核对，不接受 URL。没有注入时明确显示服务未就绪。页面恢复任务不会自动继续，进度刷新保留人工编辑草稿；账号或店铺变化立即清理页面候选。此模块没有新增依赖。

拼多多采集实现见 `electron/pdd-learning-provider.ts`：复用 `assistPartition` 与已登录分区，独立窗口仅允许拼多多商家同源导航，阻止任意弹窗；身份读取复用固定 vendor 的 `readIdentity`/身份脚本，软件账号和真实客服 ID 共同构成任务账号指纹。商品列表的 TAB、goods-name/goods-id、分离表头/数据表和 PGT 结构已按实页核对，原生查询、状态切换和翻页复用共享 `createAssistQueryMonitor`，不猜私有 HTTP，不读取 Cookie、请求头或整页业务状态。只整理列表实际可见名称、价格、库存和状态，不填造详情或规格。尚不可读的结构、分页和验证码均停止并保留错误，错误时显示独立采集窗口供核对。

聊天来源读取真实 `/mms-chat/search` 后台，使用原生 RPR 日历确认起止日期和“全部”客服后查询。当前实页只允许近30天有效日期，超出平台禁用范围明确拒绝，不回退待回会话或本机归档。一次采集页对应后台消费者列表的一页；消费者列表的左侧分页与每个会话消息的右侧分页分别核对和点击，消息按真实 ID 合并，不把首次20条当成全部历史。`electron/platform-learning-chat.ts` 复用 [Electron Debugger 官方接口](https://www.electronjs.org/docs/latest/api/debugger) 在自有学习窗口观察已验证的 `getMessagesUsers/getMessages` 原生响应，仅允许相同源与固定路径，限制响应为 1 MiB，投影店铺/消费者 ID、消息 ID、时间、角色方向与平台总数。正文只从实际消息 DOM 读取，不重放平台 HTTP、读取请求头或持久化原始响应。每行 DOM 消息 ID 与原生元数据逐条核对，并按平台 `total` 检查消息覆盖和末页控制；每会话最多确认50次后续消息页，仍有未覆盖消息或原页无法继续加载时保留部分范围，不冒充完整历史。每页原始范围随候选保存，较早页的限制不会被末页成功掩盖；未单独记录原始页码的旧候选不冒用任务的最后页面作为来源。系统事件和媒体只参与范围核对，不被编造为问答。

本轮增量验证覆盖 platform-learning-service、platform-learning-provider、platform-learning-chat、platform-learning-chat-dom、platform-learning-ui 及既有 knowledge-learning 三个文件。夹具验证持久化、原生观察边界和交互，不能作为真实平台采集验收。实页已核对商品 DOM/分页、聊天日期/消费者分页及原生消息总数/ID 的对应结构；工厂、IPC 和 UI 的实际采集仍须在整合后的原生应用验收。原生验收需从实店平台读取新资料，暂停/退出重启、核对来源及范围，保存为停用包，再显式启用并在训练场验证召回；同店切换平台账号后旧任务应拒绝继续和入库。当前交接与隔离验收以Task5报告和HANDOFF为准。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。

Task4 review: `KnowledgeVisualEvidence.vue` renders persisted `modelEvidence` and delegates image loading through the existing client asset callback. `KnowledgeUncertainCall.vue` only offers explicit retry/skip for the nonterminal uncertain state. Removed source positions remain visible as history but main excludes them from learning/publication. Manager integration only forwards evidence and the asset loader; evidence validation and lifecycle logic remain in focused main modules.

管理组件新增实际SKU/规格/动态有效期、同款建议（人工确认）、知识历史、独立全库移除范围、待学原因/上下文和恢复预览。`manager-service` 只提交不透明恢复token；重建后的新workspace由owner返回并重绑窗口，清空旧店铺弹层和异步租约。复用项目、许可与验证范围见 [KNOWLEDGE_LIBRARY.md](../../../docs/KNOWLEDGE_LIBRARY.md)。

最终审查修正：商品编辑器保留完整家族绑定供影响/关联预览，但可编辑条目与scope选项仅为共享canonical及当前店铺当前商品/SKU；来源按可编辑条目的依赖投影并标记原店铺。历史载入受entry/session约束，部分collect/daily-check任务的“继续”与付费学习不确定重试分开。主进程恢复意图、历史长键兼容及维护步骤见KNOWLEDGE_LIBRARY；不新增IPC或依赖。

2026-11-16：知识库已删除独立任务入口/页面。商品学习进度由 KnowledgeJobProgress 内嵌商品卡，按店铺及根绑定精确关联，资料步数明确区别商品数量；暂停/取消/付费重试和不确定调用确认仍可在卡片处理。采集/通用资料的未完成状态留在原页面，后台持久任务和审核门保持原样。专项原生验收使用 `node scripts/verify-knowledge-manager.mjs --inline-progress-only`，隔离合成数据，不调用付费模型。

2026-11-17：待学问题默认进入“待处理（open）”，页面提供待处理/已解决/已忽略三个查询入口；状态、搜索、店铺和页码都在仓储查询层组合，仍按20项分页，不再只读取前100项。顶栏“待学问题”计数只算 open。标记解决/忽略只更新处理状态并给出成功或失败反馈，成功后从当前状态列表消失；已解决/已忽略历史可查看中文状态并重新打开。“补充答案”仍走原有草稿自动保存与人工审核发布，标记解决不会生成或发布答案。换店或换账号会清理状态筛选和旧反馈，异步响应按账号/店铺租约丢弃。`misses` 查询的 `status` 为可选字段，旧调用不指定状态时仍返回全部，运行时按问题 ID 查历史不受分页影响。相关测试见 `tests/knowledge-miss-feedback.test.ts`、`tests/knowledge-runtime.test.ts`。

2026-11-19 尺码规则：`ShopKbPanel` 保留原自由文本尺码候选入口和 `source.kind='size'` 知识包，并嵌入 `SizeRulesPanel`。结构化规则走新增的 `list-size-rules/save-size-rule/remove-size-rule/preview-size-table/export-size-table/size-rule-template` 业务命令，仍由 `runtime.run` 进入主进程，无新 IPC、无新增依赖。规则按 `storeId + productId` 唯一绑定，停用也占位；保存和读取证据时都通过现有商品目录端口核对，`valid/missing/error` 分开处理，失效或读取失败的目录不进入证据。接待、兼容训练和知识库试问共用 `electron/size-rules/context.ts` 的同一 `resolve`；正式选码由表内 `eligibleLabels`/`clarification` 确定性生成，未知 `XL` 等模型文本不能绕过，候选再按生成 trace 与规则版本组合 knowledge/PDD 当前性守卫。训练/接待拿到 vendor 禁词与店铺长度处理后的最终文本时只校验，不重写或重插禁词。界面由 `use-size-rules-controller.ts` 统一异步 owner，表格/绑定拆为聚焦子组件。单位/闭区间、同条换人截断、压缩前受测证据、CSV 版本往返、原子写/双 CAS、损坏文件 containment 和迟到结果处理详见 [SIZE_RULES.md](../../../docs/SIZE_RULES.md)；相关测试见 `tests/size-rules-*.test.ts` 与 `tests/knowledge-learning-ui.test.ts`。

2026-11-19 托管商品详情学习：桌面学习器在托管模式下发送现有类型化付费 chat 字段 `purpose=learning`、当前策略 revision 和来源 `pdd_detail_text/pdd_detail_image`，不再把 candidates 当普通回复请求。来源只允许当前拼多多店铺由采集器生成的静态/动态详情文字或详情图片；普通导入、聊天、其他平台和未知来源会被明确拒绝。真实 assembly 动态转发学习预检，local Key 不暴露托管协议。启动任务前与每次付费调用前严格读取当前托管策略，旧服务端、策略禁用/未允许来源、账号切换、持久 pause 和取消都在 submitted checkpoint 前失败；单商品调用上限按真实 `storeId + productId` 汇总根商品、SKU、文本分段和图片分块，超限不建任务或提交。estimate 的消费是原子事务，并发启动只创建一个任务。已知服务端计费前拒绝落为 failed，未知结果仍需人工处理，不自动重试。旧 submitted/needs-confirmation 任务不自动重放；旧 local Key 估算仍可继续，旧托管估算需重新估算。本机 Key 路径、独立视觉、OCR、单件/批量、估算确认和草稿审核不变；普通 reply/trial 请求体不变。线上仍需兼容服务端，源码接入不代表 production 已部署。

2026-11-18 控制器职责拆分：`manager-controller.ts` 继续唯一持有草稿/审核生命周期、跨视图协调、租约与工作区上下文交接，并保持 `useKnowledgeManager()` 返回对象、页面布局/交互/文案不变。目录采集/筛选/选择/缩略图抽到 `catalog-controller.ts`，翻页继续要求同一 `identityVersion`/`scopeToken`，未知总数不自动全选，缩略图两次异步读取后重新核对 scope；备份/恢复/清空抽到 `maintenance-controller.ts`，自持预览与 restoreLease，普通读取仍走 manager 注入的受租约保护 `client()`，恢复/清空成功后替换工作区，故意使用未套旧租约 guard 的 `createKnowledgeClient` 并由 owner 应用新 context；商品学习/识图抽到 `product-learning-controller.ts`，只交回选择范围与编辑器所需来源；同款创建/元数据/删除预览/解绑/整体重关联抽到 `product-family-controller.ts`，待学问题筛选/处理中/反馈抽到 `miss-controller.ts`。后两者只持有各自 refs 和原方法，租约、`client()` 守卫、`saveDraft`/`closeEditor`/`refresh` 顺序与销毁仍由 manager 唯一持有；SKU 根限制、完整 binding revision 集合、分页和文案不变。均复用现有 Vue composable 与普通 refs，无新依赖、无新 IPC。无消费者的旧 demo 工厂已删除，仍被组件使用的 demo 保留。
