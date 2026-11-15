# 审核知识库接线（2026-11-15）

当前账号 `managed.dataDir/knowledge.sqlite` 是知识唯一写入仓储。`local-runtime` 在厂商旧服务构造前注入 `createKnowledgeCompatibilityPorts`；旧商品、意图保存/导入只生成草稿，原有明确人工纠错审核路径保留。新管理编辑、审核、整体同款关联与来源刷新后，持久兼容基线拒绝旧编辑器覆盖较新资料。迁移失败保留原文件，只读诊断可查看；正式回复/试问明确暂停，不把失败冒充空知识。

`knowledge-platform-products.ts` 提供旧平台详情 get/upsert 的 SQLite 兼容口。已有采集器先建立物理商品绑定，再记录原始来源和SKU。旧平台档案不再写JSON。此兼容快照仍包含采集时间与动态值；新的采集任务另存静态、图像和SKU动态来源，避免每次动态快照变化使不相关的静态引用撤回。它不解析文件、不生成问答、更不发布原始资料。

## 独立管理窗口

`#/knowledge` 是受信独立窗口，店铺侧栏“导入知识”及配置中心“查看商品”均经 `openKnowledgeManager(storeId)` 聚焦同一实例。窗口店铺选择仅在模块状态中保存，不调用接待选择或打开平台页。窗口按工作区面积收敛，关闭先请求编辑器保存，成功后隐藏；保存失败留在当前编辑器。只有应用退出才销毁窗口。

新增固定通道 `knowledge:open/context/request/hide` 及主进程发出的 `knowledge:context/close-request`。调用前复用主帧、注册窗口及受信URL校验；每次请求严格解析固定操作、工作区租约，晚到结果再次校验。没有任意仓储方法、路径、模型请求或密钥IPC；原始资料按文本插值显示，图片仅读取已登记资产并校验安全位图格式。Vue经模块服务与共享平台调用，不直接使用文件系统、网络或Electron。

商品根卡片分页20项，来源只读轻量摘要；图片进入视口后加载。问答草稿自动保存且发布独立，普通快照刷新不替换草稿；冲突保留文本并可重试、放弃或继续编辑。审核显示作用范围、来源精确版本、有效期及受影响店铺。公共模板可跨店浏览并显式选店应用，“为本店创建覆盖”生成独立条目，保留原模板。任务、待学问题、设置属于次级视图。导出带审核状态；全库备份复用SQLite一致快照API。

同款人工确认以根商品为单位，整个物理商品及全部SKU继承同一共享商品family，SKU只维护本店规格、知识和动态差异。`reassociate-product` 必须提交目标canonical版本及当前root/SKU完整ID与版本集合；主进程复核后在同一事务整体更新canonicalId，任何变化全回滚，保留物理身份、来源、本店覆盖和动态值。单SKU跨family重定向拒绝。解除根商品关联仍级联其本店SKU，其他店保留。

## 正式回复、训练和试问

`knowledge.context` 先依本店显式商品ID或唯一精确标题定位，复用已有SKU选择器仅识别身份，原始平台JSON不加入模型。统一仓储只召回审核范围、有效期及完整预算内条目。厂商可选 `completeKnowledge` 保留完整证据，随后仍进入原有通用表达参考与16K触发/8K目标压缩器；未注入的上游默认路径保留。

知识引用按同次resolutionID交给精确正式traceID，trace返回同次生成并随worker进入原批准门。知识撤回、解绑、覆盖变化、来源变化或TTL到期后，`guardProposal` 使批准失败并保留知识原因。守卫延续到适配器逐字输入及最终点击，同时保留店铺发送模式、会话网页基线、限流与回执检查。只有显式 `purpose: reply` 的真实uid未覆盖问题进入待学队列；训练、试问不写正式未命中记录。

`KnowledgeRuntime.complete` 只在主进程提供：复用现有本机模型配置/加密密钥或托管chat计费传输，支持AbortSignal、账号租约及当前模型图片能力，不要求开启买家识图或店铺AI，不提供发送/发布。托管模式的输出预算仍受既有托管服务策略控制，本地maxTokens不改服务器策略。

## 后续采集/解析服务挂点

`runtime.knowledge().setPipeline(port)` 只注册一次协调器；`KnowledgePipelinePort.request` 类型来自 `src/shared/contracts/knowledge-pipeline.ts`。动作包括 capabilities、catalog、choose-sources、estimate、start、pause、resume、cancel。首次采集使用目录identityVersion/scopeToken及明确productIds或allMatching/total；已有资料刷新/学习使用bindingIds/sourceIds，学习携带estimateId。start/resume必须先持久化并返回jobId，再在独立worker中做I/O，不占工作区命令队列。协调器负责store移除和dispose取消；后台每次回写仍须检查账号、店铺与任务版本。

协调器已注册Task3目录/采集与Task4文件/学习；日检尚未注册，capabilities如实为false。Task4具体行为见下节，每日检查留给Task5。没有恢复备份的UI；恢复API仍为Task1的停写校验接口。

旧跨店商品复制与回滚不能确认物理映射或保留动态差异，运行时拒绝其商品写入；同步页将商品项禁用并提供知识库入口，文字欢迎、识图及人工关键词配置同步保留。

原Task2复用既有Vue3、Electron43、Zod、MiniSearch、PapaParse与模型服务；Task4使用已锁定的PDF.js/Mammoth/read-excel-file，详见下节。针对性验证脚本：`node scripts/verify-knowledge-manager.mjs`，使用独立构建、临时账号、合成资料、loopback模型和hidden/offscreen窗口，证据位于 `artifacts/knowledge-manager-check/evidence`。它不访问实店，不显示用户窗口，不调用付费模型，不代表真实平台或模型效果验收。

## 目录优先的只读采集（Task3）

`local-runtime` 在现有 `createPddLearningProvider` 组装后只注册一次 `createKnowledgePipelineCoordinator()`，采集处理器经 `register(createKnowledgeCollector(...))` 接入。后续文件/学习及每日检查处理器实现 `KnowledgePipelineHandler`，按 `handles(input)` 的动作和 `kind` 分派，返回自己的能力字段；不要再次调用 `setPipeline`。移店/关闭会逐一取消所有处理器，即使另一处理器清理失败也继续清理。没有新依赖、IPC或平台写方法。

目录使用已有已核对的在售原生筛选、独立WebContents、相同店铺分区和统一浏览器UA；`catalogOnly` 不打开详情，明确的 `productIds` 只读取当前已验证页内对应详情。缺少已有适配器时说明先登录，不调用旧身份包装器偷偷导航接待页。`quiet:true` 保证错误不抢焦点，显式旧页面 reveal 仍由用户动作决定。

目录身份、筛选词、已验证商品集合、原生页游标和30分钟范围令牌留在主进程。跨页选项保留明确数量，搜索按标题/平台ID过滤实际已读页；筛选总数在全目录未核对时保持未知。仅全部原生分页、声明总量、去重数量与范围证据一致时启用“当前筛选全部”；总量未知、重复页、上限或未读页不能成为全店成功。每任务最多1000商品，目录最多1000页/10000行，不静默截成首屏。原生范围发生变化须重新建立目录。

`start/resume` 先持久化并返回jobId，定时异步工作器逐商品提交原料与checkpoint；cancel/pause独立中止，在途平台结果晚到后复核任务、账号、店铺以及完整商品/SKU绑定集合，不能复活已取消任务。重启时running及queued collect变为paused，不自动访问平台。原生登录、验证码或未知错误暂停；900009仍按已有provider的明确限制记录partial。图片/详情限制产生needs-confirmation，明确resume只重试受限项，已成功项不重复生成来源版本。

原料标签常量 `collectorMaterialLabels` 在 `electron/knowledge/collector-materials.ts` 导出：平台目录快照、兼容完整详情JSON和平台采集范围保留原始列表、capture时间、实际页scope、详情限制与每张图片失败原因；学习只能按需要选择稳定的“平台静态资料/平台图片资料”以及对应SKU的“平台动态快照”。静态JSON排除采集时间、价格、库存和请求参数；图片签名参数单独归一，原URL仍在raw/capture层。实际静态或图像字节变化使依赖来源的已审核知识失效，手工无依赖知识保留。动态快照按本店SKU保存原capture时间；complete快照确认不再列出的SKU记录not-listed并撤销旧动态依赖，保留物理绑定。未经验证缺失不能猜测库存或价格。

图片只允许当前已验证详情实际给出的HTTPS平台CDN URL，经当前店铺Session读取，禁跳转、限制10MB/图与50MB/商品，校验PNG/JPEG/GIF/WebP MIME和字节。SVG/未知类型/失败保留计数和来源，不冒充图片已识别；成功字节以SHA256资产登记供预览/后续模型。远端URL不是模型图片支持，没有OCR、文件解析、模型学习、自动发布或日检调度。

本轮复用已有真实来源文档与脱敏夹具（PRODUCT_KNOWLEDGE.md、PLATFORM_PRODUCT_DETAILS.md）。新的实店多页、CDN真实下载验收尚未执行：用户桌面控制仍被Esc停止，没有操作用户窗口、重启其他worktree应用或访问真实付费模型。只运行直接相关测试及临时数据的hidden/offscreen验收。

## 资料导入、学习和审核（Task4，2026-11-15）

当前已在同一 dispatcher 注册 `createKnowledgeSourcePipeline`，没有替换 Task3 collector 或二次 setPipeline。主进程 `sources.ts` 复用锁定 PDF.js6.5.438、Mammoth1.13.0、read-excel-file9.3.17 和既有 PapaParse/Zod；`imports.ts` 管导入预览与逐项任务，`learning.ts` 管估算、当前模型调用和 durable checkpoints，`source-pipeline.ts` 只做分派。Vue 新增 ingestion-controller、batch-review 及专用预览/图片/费用不确定/结果组件，组件不接触路径、密钥或网络。

- 商品内路径：商品卡“编辑”→“原始资料 / 来源版本”→“导入本商品资料”；标题/编号与预览逐行目标可核对，PDF/图片只绑定该物理商品。该入口在真实离屏渲染用 elementFromPoint 证明未被编辑层遮挡。商品说明不需要借用全店通用来源。顶部导入明确标为“商品CSV / 通用资料”；无商品目标时预览写明“本店通用问答/资料”，必须再次确认。
- 主进程原生文件选择只回传 opaque sourceIds；原始字节按 hash 保存一次。PDF每页文本和栅格块、DOCX提取行/内嵌图序号、XLSX所有sheet/行/列值、CSV逻辑行、文本行、聊天messageId均有来源。新增 locator.imageAssetId 指向主进程生成的安全图片，assetId仍指原文件。图片/扫描页经≤1400×1400分块进入当前模型；原始PDF/DOCX不加载进有业务preload的页面。图片查看只显示已校验位图，不执行HTML、脚本或外链。Mammoth关闭外部文件访问，转换HTML从不渲染。
- TXT/MD/CSV/JSON使用BOM、严格UTF8、证据支持的UTF16或GB18030解码，预览标明编码并保留原字节。CSV productId/title创建或更新当前店铺物理商品原料，不变成一个巨型商品文档；同文件同商品内容变化更新来源revision。价格/库存/启用等其他列保留原文件，不当作永久已审核事实。旧意图JSON只产生未审核问答，忽略导入启用/审核/其他店铺标记；产品编号必须在所选本店已有绑定中完整映射，否则拒绝。重复目标/来源、目标范围、编码和解析警告在预览中显示，25行分页不删掉其他导入项。
- 已有归档入口：“导入本机归档聊天”→日期范围→实际数量/时间预览→确认导入→“学习本店通用资料”→估算→明确开始。只使用 `read().conversations` 当前店铺已实际归档的 buyer/seller 文字，每会话有限现有记录（最多100条）；媒体只计数，范围之外和其他店铺不导入，不主动抓取平台历史。文件聊天支持JSON消息数组 `{from:'buyer'|'seller', content, msgId?, ts?}`，来源保留文件、消息ID/行。两类聊天默认store scope，不自动提升共享商品服务/发货/售后承诺。
- main-only model port 增加 guarded vision/modelIdentity/assertStore 元数据/守卫；complete仍复用当前AiClient、加密Key或托管chat计费。学习按实际cl100k BPE每次计量≤8192输入估算token、每图预留1536、maxTokens4096，自己完整分块，不依赖只在reply执行的压缩器。估算固定来源revision、目标binding revision/完整family以及当前模型/能力；start范围变化或后台写入前租约变化均拒绝。平台raw/capture/catalog不学习为共享事实，动态项仅binding/store且expiresAt=实际capturedAt+TTL，绝不以现在续期。
- 所有付费调用先估算再由用户明确start。任务先持久化/返回jobId，再异步执行，不占workspace命令tail或在网络期间持有SQL事务。每调用先写submitted、后写received原响应，再在同事务保存候选和完成索引。结果不确定为needs-confirmation；普通resume不重放，只有明确resolve-uncertain retry（提示可能重复计费）或skip（保留覆盖不完整提示）。已收到响应但保存失败的resume只重用落盘响应。取消/暂停/移店/账号退出中止在途工作，迟到结果不入库；关闭管理窗不拥有或销毁任务。重启running/queued learn/import/collect等待人工；submitted保持需明确决定。
- 模型输出严格schema和allowed sourceId，纯文字答案/证据必须是本分块连续原文；图片为当前模型转写，仍需人工核对，不宣称模型语义正确。模型不能决定店铺/SKU/发布。只saveDraft；零候选、缺失平台图片及明确跳过均有完成提示，不把空解析或图片URL当识别成功。已有编辑/排除/模板店铺应用/本店有效期覆盖保留。批量审核逐商品显示approved/skipped/failed，某条stale不掩盖已成功项，失败草稿原文保留。

新增同一窄pipeline动作：preview-import、archive-chat(from/to)、store-materials、review-targets、resolve-uncertain(decision)。start(kind:import)的estimateId是主进程预览ID；start(kind:learn)是学习估算ID。已有pause/resume/cancel按持久job.kind分派。知识服务的pipeline输入先经Zod变成普通数据再走Electron structured clone，防止Vue响应式数组无法跨IPC。

验证：`node scripts/verify-knowledge-ingestion.mjs`复用已有hidden/offscreen测试架构，真实CJS/Electron+preload+隔离SQLite+本机HTTP模型，覆盖解析、CSV预览导入、商品内扫描PDF绑定/大图/图像模型输入、估算手动启动、不确定调用不重放、归档日期入口及部分批量审核。完整日志和限制见 `.superpowers/sdd/2026-11-15-knowledge-library/task-4-report.md`。尚未做真实云模型识别质量、真实店铺/买家、Release打包或最大规模吞吐验收；日检、恢复UI和性能属于Task5。GIF明确仅首帧，后续动画帧需要拆成静态图补充。
