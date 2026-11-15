# 审核知识库接线（2026-11-15）

当前账号 `managed.dataDir/knowledge.sqlite` 是知识唯一写入仓储。`local-runtime` 在厂商旧服务构造前注入 `createKnowledgeCompatibilityPorts`；旧商品、意图保存/导入只生成草稿，原有明确人工纠错审核路径保留。新管理编辑、审核、整体同款关联与来源刷新后，持久兼容基线拒绝旧编辑器覆盖较新资料。迁移失败保留原文件，只读诊断可查看；正式回复/试问明确暂停，不把失败冒充空知识。

`knowledge-platform-products.ts` 提供旧平台详情 get/upsert 的 SQLite 兼容口。已有采集器先建立物理商品绑定，再记录原始来源和SKU。旧平台档案不再写JSON。此兼容快照仍包含采集时间与动态值；后续采集任务须按静态/动态稳定来源拆分，避免每次动态快照变化使不相关的静态引用撤回。它不解析文件、不生成问答、更不发布原始资料。

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

未注册时capabilities明确全为false，UI禁用采集/导入/学习，不伪造成功。后续任务负责具体拼多多目录、来源选择器、文件解析、图片/扫描页处理、模型结果校验、学习工作器与每日检查。Task2没有这些执行器，也没有恢复备份的UI；恢复API仍为Task1的停写校验接口。

旧跨店商品复制与回滚不能确认物理映射或保留动态差异，运行时拒绝其商品写入；同步页将商品项禁用并提供知识库入口，文字欢迎、识图及人工关键词配置同步保留。

复用既有Vue3、Electron43、Zod、MiniSearch、PapaParse与模型服务，无新依赖。针对性验证脚本：`node scripts/verify-knowledge-manager.mjs`，使用独立构建、临时账号、合成资料、loopback模型和hidden/offscreen窗口，证据位于 `artifacts/knowledge-manager-check/evidence`。它不访问实店，不显示用户窗口，不调用付费模型，不代表真实平台或模型效果验收。
