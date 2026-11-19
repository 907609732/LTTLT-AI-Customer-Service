# 架构导航

2026-11-19 本机视觉与尺码：`local-runtime → createVisionModelAssembly → VisionModelSettingsStore/Runtime → onKnowledgeModel → knowledge.setModel` 形成独立知识图片端口。`visionAssembly` 在 store 损坏时返回仅关闭图片的端口，managed 模式直接使用原托管端口；`capabilities.visionModel` 只投影安全六字段，`get/save/probe/verify/clear-vision-key` 走现有 business 命令，`LoginDialog` 经 settings 模块服务挂载组件。知识库 trial 在 `knowledge-runtime` 的原预算/租约链中注入尺码证据并在模型返回后复核规则版本；正式接待 beforeSend 只校验 vendor 过滤后的最终文本，不做重写。尺码候选按生成 trace 有界记录，淘汰证据用 tombstone 闭锁，普通无尺码证据不受影响。

自定义模型目录沿 `LoginDialog → list-custom-models 业务命令 → local-runtime → electron/list-custom-models.ts → 用户提供的 /models` 查询；Bearer Key 仅由主进程临时使用，不记录日志或持久化，组件不直接联网。模型返回只接受 `data[].id` 或 `models[].id`，去重并限制最多 5000 项；用户仍可手动输入模型名。查询失败不更改已保存的模型配置。该能力面向兼容 OpenAI Models API 的服务，不保证所有自定义 API 都提供相同目录端点。

1.0.13 图片识别：`local-runtime → knowledge/image-ocr → windows-ocr → Windows.Media.Ocr`，复用既有图片分块、来源资产和元数据缓存。source-pipeline 在学习估算前识别，learning 将缓存 OCR 作为不可信辅助材料与实际像素一同提交；预览沿原 knowledge/pipeline 增加 recognize-images 动作，无新增 IPC 或外部 MCP 工具。取消、店铺/来源版本和账号租约保护延续至异步完成。

模型批量节奏沿 `KnowledgeModelPort.minimumIntervalMs → knowledge.modelMinimumIntervalMs → source-pipeline → learner` 转发，托管默认 13000 毫秒、本机 0。等待在付费提交检查点之前，取消会结束等待。失败已收到响应的片段可用同一内部 pipeline 的 retry-received 动作归档并重新生成，不能用于未知提交/已取消/已完成任务，不向外部 AI MCP 开放。

`knowledge/model-output` 用固定 jsonrepair 3.15.0 做受限语法兼容；严格解析优先，修复白名单仅删除字符串外至多两个多余结束大括号，原文与修复文由 learner 保存审计元数据。该层不修改答案、来源、模型权限或审核状态，后续 Zod 和依据验证不跳过。

1.0.9新增受限AI接口：官方MCP stdio连接器→本机认证gateway→agent/service→当前WorkspaceRuntime/knowledge。仅开放查询、明确商品采集与本店待审核草稿，不透传通用命令；工作区/认证变更后旧请求失效。1.0.69在同一gateway、契约和原生CAS上增加MCP与CLI共用的配置schema/get/preview/apply，只允许reply-pacing、welcome、vision三组，不开放模型参数、凭据、AI启停或发送审批。接口、连接配置及许可见[AI_INTERFACE.md](AI_INTERFACE.md)。

2026-11-15审核知识接线：`local-runtime → knowledge-runtime / knowledge-compatibility / knowledge-platform-products → knowledge repository`，厂商旧JSON构造前注入兼容端口；独立管理窗口经固定knowledge IPC与当前账号租约访问。详见 [KNOWLEDGE_LIBRARY.md](KNOWLEDGE_LIBRARY.md)。SKU继承根商品同款family，整体重关联使用完整版本集合与单事务；单SKU跨family重定向拒绝。

2026-11-15目录采集：`local-runtime → knowledge/pipeline（唯一注册）→ knowledge/collector → 既有pdd-learning-provider`；原始/静态/图片/SKU动态来源分层持久化，source-pipeline经register接入文件/学习，daily调度复用collector的daily-check任务。详见[KNOWLEDGE_LIBRARY.md](KNOWLEDGE_LIBRARY.md)。

2026-11-15资料学习：同一knowledge/pipeline追加source-pipeline→sources/imports/learning，main拥有文件路径、原件、范围/版本与模型端口；Vue通过受限预览、估算和明确retry/skip维护流程。新locator与任务恢复规则见KNOWLEDGE_LIBRARY的文件/学习章节。

## 店铺发送模式与回复监控（2026-11-15）

复用 Electron 43 的 parent/showInactive/setBounds，不新增依赖；小监控为受信独立渲染路由 `/reply-monitor`，在主窗口内左下角随动，非全局置顶。`createWindow({compact:true,parent})` 不参与主窗口默认最大化或自动聚焦。详细日志仍由手动入口打开。

方案检索采用[Electron官方BrowserWindow实现与文档](https://github.com/electron/electron/blob/main/docs/api/browser-window.md)：与现有Electron43/Windows技术栈一致，复用项目已使用的MIT许可依赖；原生父子窗口和无焦点显示已覆盖需求，无需第三方悬浮窗库。

`set-store-send-mode`、`open-reply-monitor` 使用原有受信、工作区绑定业务命令，无新 IPC 通道。StoreSendModes 在 managed.dataDir 下原子保存模式，快照装配时附加店铺 sendMode。审核与显式自动模式共用 ReviewConsole，自动候选绑定运行期模式版本；旧审核候选不会因后来开启自动而获批。网页适配器在模型前等待有效消息基线，不修改 vendor。发送与取消检查延续至逐字输入和最终点击，详见 RUNTIME_LOGS.md。

2026-11-18监控会话视图：`auxiliary/reply-monitor.ts` 从现有 snapshot 只读投影当前店铺+UID 的会话、买卖/系统气泡、候选和商品摘要；`ReviewConsole` 只从真实生成 trace 的 `reviewContext.productId/goodsTitle` 记录当前商品，候选仅复制同店同买家 trace，主进程按同店精确编号查询现有知识/平台详情。`ReplyMonitorView` 在 340×300 内把商品摘要固定在气泡上方，气泡区独立滚动；未知/系统来源不冒充买卖方，草稿/失败候选与真实卖家回显分开展示。无新 IPC、编辑、删除或发送能力，确认/取消仍走原 `review-reply`。详见 [REPLY_MONITOR.md](REPLY_MONITOR.md)。

2026-11-18源码开发调试：`local-runtime → electron/reply-monitor-window` 仍是唯一监控子窗，源码版可由 `electron/developer-debug/controller` 展开 GM/CMD；`ipc.ts` 只接受当前监控主 frame、owner webContents 与 workspace 的固定请求。`gm.ts` 是有界注册表（help/status/stores/logs/pdd-popup），不提供 eval；`popup-policy.ts` 复用厂家 `webContentsOf(storeId)` 的实际 PDD 页并只在内存按店改新窗处理器；`pty.ts` 动态 require node-pty，ConPTY 会话关闭/切换工作区结束进程树。打包版在主进程完全不创建 controller、不注册 IPC，普通 preload 编译关闭调试桥，`developer-preload.cjs` 不进入 electron-builder files。前端入口经 auxiliary 的 `/reply-monitor`，xterm 只在首次进入 CMD 标签时异步加载。详见 [DEVELOPER_DEBUG.md](DEVELOPER_DEBUG.md)。

E:\~1awucheng\Plastic SCM\AI电商客服软件\client 是当前工作区的独立项目根，完整目录与文件边界见 PROJECT_LAYOUT.md。所有工具从此根执行；.github/workflows/lingtu-ai-desktop.yml 也从仓库根运行 npm，不再设置外层 yunduo-ui 工作目录。客户端实际运行依赖本工程 vendor，独立服务端保存在本工程 server，不引用兄弟工作区。

## 启动链路

并行整合新增的持久化、桥接和生命周期：local-runtime 在当前 managed.dataDir 下持有 ReportingPipeline、StoreSync 和 ReceptionScheduler；随机 workspaceId 只作为请求租约，不作为持久文件定位。工作区包装器逐次解析当前实例并丢弃切换后的晚到结果。main 统一注册 custom-phrases、store-sync、scheduler IPC；preload 仅暴露固定窄方法。报表跟随已采集事件及审批状态观察；调度在认证变化时启停，未验证平台能力保持 blocked，不具备绕过批准的发送方法。托管团队/计费通过 managed-business 严格路径和方法白名单复用设备会话，令牌不进入渲染层；Go 两领域注册到同一 clientAuth 后。详见 docs/parallel/INTEGRATION.md。

浏览器：`index.html → src/app/main.ts → App.vue → router.ts`。
桌面：`electron/main.ts → windows.ts → dist/index.html`；`ipc.ts` 注册能力，`preload.ts` 只暴露 `DesktopApi`。构建后的桌面文件位于 `dist-electron`。

## 维护性职责拆分（1.0.56）

本轮只调整装配与控制器归属，不新增 IPC、依赖、持久化格式或发送权限；公开业务命令、数据目录、审批门和页面文案保持不变。1.0.55 的自定义模型目录（`list-custom-models` → `electron/list-custom-models.ts`）由主线功能合入，仍走原命令和受限 `/models` 查询，不属于本轮拆分实现。

原 `local-runtime.ts` 的知识/辅助装配拆到 `electron/runtime/`：

- `knowledge-pipeline-assembly.ts`：组装 knowledge/collector、daily、image-ocr、source-pipeline 与 pipeline coordinator，并向已注册的 knowledge runtime 提供实时端口；管道的注册/替换仍由 knowledge runtime 负责。
- `knowledge-learning-assembly.ts`：组装本店草稿写入、collected-products 与 platform learning service；共享 pdd learning provider 仍由组合根创建和销毁，装配不接管其生命周期。
- `assist-runtime.ts`：辅助中心平台页、读取器与采集快照；只有出现在成功发布快照中的行才可解析详情入口。
- `assist-detail-catalog.ts`：有界保存已观察/已发布详情 URL，未发布前不向渲染层暴露。

`electron/local-runtime.ts` 与 workspace runtime 仍是组合根：统一创建顺序、账号/店铺租约、AI/发送审批、维护替换和 `RuntimeResourceDisposer` 关闭顺序；拆出的 assembly 只接收显式端口，不自行新建全局客户端或 IPC。

知识库渲染侧仍由 `manager-controller.ts` 作为唯一协调者和编辑/审核生命周期所有者；目录采集在 `catalog-controller.ts`（翻页 identityVersion/scopeToken 一致、未知总数不全选、缩略图两次读取后复核），备份/恢复/清空在 `maintenance-controller.ts`（自持预览与 restoreLease；恢复/清空使用未套旧租约 guard 的 `createKnowledgeClient`，由 owner 应用新 context），商品学习/识图在 `product-learning-controller.ts`。2026-11-18 第二轮又把商品家族维护（同款创建/元数据/删除预览/解绑/整体重关联）移到 `product-family-controller.ts`，待学问题状态与处理移到 `miss-controller.ts`；两者只接收 manager 的显式端口和 refs，租约、草稿保存/关闭、刷新、client 守卫和销毁仍由 manager 唯一持有。`useKnowledgeManager()` 返回对象 126 项及顺序、页面交互与文案不变。

2026-11-18 第二轮清理已删除无消费者还原残留，逐项清单和删除依据收在维护计划与最终验收回执；本节只保留职责和依赖结论。仍被模板、活组件、demo、构建入口或测试引用的图标/demo、legacy CSS、preload/MCP 和主进程同步服务/共享契约均保留；前端 `sync` 目录已无源码，旧 `/store-sync` 兼容跳转不变。

## 目录与职责

| 目录                      | 职责                                                  |
| ------------------------- | ----------------------------------------------------- |
| .github                   | 独立主项目的云端检查与 Windows 构建，只上传产物       |
| config                    | TypeScript、ESLint、Prettier 与 electron-builder 配置 |
| docs/legal                | AGPL、商业授权与第三方权利说明                        |
| electron                  | Electron 主进程、preload、业务运行时与平台接入        |
| server                    | 独立托管 API、原生管理网页覆盖层与运维说明            |
| vendor/lingtu-runtime     | 固定来源的客户端运行依赖与许可                        |
| src/app                   | 入口、布局、路由、菜单注册和演示服务装配              |
| src/modules/workbench     | 工作台、快捷回复和定时任务界面                        |
| src/modules/account       | 登录、账号、团队和店铺登录弹窗                        |
| src/modules/shops         | 店铺、商品及相关弹窗                                  |
| src/modules/reception     | 转人工、欢迎语、自动操作、图片识别                    |
| src/modules/knowledge     | 意图、知识、模型定制和训练                            |
| src/modules/quality       | 工单、质检和售后预警                                  |
| src/modules/billing       | 充值、订单、算力与账户聚合界面                        |
| src/modules/settings      | 软件偏好和设置                                        |
| src/modules/auxiliary     | 辅助中心、聚合后台、助手及弹层                        |
| src/modules/simulation    | 本机模拟店铺客服台与会话回复界面                      |
| src/shared                | 类型契约、桌面适配、图标、公共 UI                     |
| src/styles/legacy         | 还原样式兼容层，不直接重生成                          |
| tests / electron/smoke.ts | 逻辑测试 / 真实桌面冒烟                               |
| artifacts                 | 忽略的源码备份、截图和测试报告                        |

跨模块只经公开入口导入组件。账户聚合依赖账号与设置属于现有界面组合；后续新增业务逻辑应放回各自模块，避免将 billing 扩展为全局业务中心。

## 数据与接口

六步店铺助手见SHOP_SETUP_WIZARD.md：shops/setup-rules复用已有模型方案命令，克隆保留原规则后仅绑定本店，不新增持久化格式、IPC或第三方依赖；助手字段以有版本的自有区块存入提示规则，完整校验及关闭条件清理后才保存。新增真实店铺通过setup-store.queueAfterLogin等认证结果，不能以open-store成功代替登录成功。MainLayout只对右侧内容设inert并隐藏原生页，保留左侧店铺栏/顶部导航交互；助手与原生页同为x300/y72内容范围。

店铺侧栏与新手引导见SHOP_SIDEBAR_SETUP.md。App挂载shops公开的ShopSetupGuide，MainLayout在引导可见时隐藏原生平台页；引导状态按当前workspace/store临时绑定，切换后取消晚到登录。新增open-store-backend走既有业务命令通道，经electron/store-backend校验权限和店铺后复用受限assist-platform-host固定首页，不接受渲染层网址，不新增任意导航IPC。

shared/customer-service 保存内置 80 条通用改写及纯检索函数，workbench 快捷回复按场景浏览并通过受控 copyGenericPhrase(id) 复制。主进程 generic-phrases.ts 以最新买家文字召回最多 3 条静态表达，先加入用途限制与使用条件，再交给原压缩器计量；正式回复/训练均经 local-runtime 的同一装配。来源、IPC 与事实边界见 GENERIC_PHRASES.md。

electron/conversation-context.ts 在主进程按店铺和买家读取最新归档，合并平台历史/当前批次并排序去重，再交给 AiClient 与统一压缩器；不再受上游 mergeThread 最近 20 条限制。local-runtime 注入 resolveConversationThread，backend 仅转接给 modelClient.resolveThread；未注入时上游默认行为不变。历史上下文不改变当前批次的诊断引用和审批网页基线。

message-diagnostics.ts 将采集消息与引擎 decision、正式请求 submitted、生成结果及确认状态关联；只输出 LogEntry.ai DTO，不把 worker 的 Set/Map 或运行时对象传给渲染层。证据早于采集日志时使用有界缓存补关联，不同店铺/买家/真实消息 ID 隔离。SettingsView 的 REPLY_PACING 是现有配置命令的受限适配，秒/毫秒转换和旧值检查在后端完成。

共享 review 契约增加可选 startedAt/completedAt/durationMs，兼容旧记录。正式回复时长由 AiClient.reply 入口和正文完成点的单调时钟差提供，trace 接收时不重新计算发送阶段耗时；摘要回合在 ReviewConsole 中独立计量，计时 Map 随最多 40 条 trace 淘汰及退出清理。正常 reply:throttled 在用户日志入口过滤，不修改引擎节流。

上下文在 AiClient 完整组装 messages 后交给注入的 electron/context-compression.ts：16K 估算触发，原系统及近期消息保护，使用当前模型摘要旧资料，正式请求目标 8K。摘要与正式请求各自 trace，review 契约携带计量与摘要元数据；待发送候选只关联正式回复 trace。全程不新增 IPC 或跨会话摘要缓存。细节见 CONTEXT_COMPRESSION.md。

桌面由 electron/local-runtime.ts 装配固定运行时，默认 local，可按公开来源配置显式选择 managed。managed-controller 复用受限设备会话协议；本机与所有托管账号共用同一本机 `local-runtime` 业务目录和 `yunduo-local` 平台分区，登录只决定托管 AI、团队与计费资格，模式/账号切换需停 AI 并重启。旧 `managed-workspaces` 目录保留但不读取、不自动合并。server/ 独立保留 Go 与原生管理网页，不替换 Vue。business-ipc 继续提供白名单 snapshot/execute/event，契约过滤凭据；见 MANAGED_SERVICE.md。

渲染层由 shared/platform/backend.ts 适配桌面桥，shared/state/runtime.ts 的 Pinia store 共享快照、店铺选择及平台展示。模块组件保留自己的编辑草稿；商品服务在模块内转换分页和校验响应。真实保存使用后端版本检查，不将页面显示或夹具结果视为真实买家操作成功。

app/services.ts 兼容原有页面查询及浏览器预览，新增真实业务以 backend 契约为准，不继续向旧演示接口增加网络操作。未接线的 demo 工厂仅用于旧视图，不能用作真实 DTO。

local 模式资料与服务商密钥留在本机独立目录，模型请求交给用户配置的服务商；managed 模式使用显式配置的账号/额度服务，只加密保存受限会话。业务资料本机与托管共用同一 `local-runtime` 目录，不向托管账号复制、迁移或额外上传本机原始资料；调用所需上下文发往选定托管服务，不额外上传调试快照。完整能力和步骤见 LOCAL_INTEGRATION.md、MANAGED_SERVICE.md。

## 平台采集、订单与操作审批

`local-runtime.ts` 为当前账号装配平台学习、订单和接待服务，`platform-feature-ipc.ts` 只提供固定操作并验证应用主 frame、workspace 和输出契约。`workspace-runtime.ts` 在账号切换后拒绝旧请求和迟到结果。资源清理由 `RuntimeResourceDisposer` 逐项执行，磁盘错误不会跳过凭据、平台及后端关闭，失败项可重试。

拼多多商品、订单、历史聊天各用独立受限后台窗口，复用已验证店铺登录分区。原生查询由页面自己的控件发起，不重放私有 HTTP；每页核对店铺身份、筛选、日期、页码及总数。共享 Session 查询监听按 WebContents 分流，支持本次实页观察到的请求路径，避免采集器互相覆盖或把广告请求失败当成业务失败。历史聊天窗口的有界原生响应观察只保留身份、消息 ID、类型、时间和总数，正文从 DOM 读取，不把响应原文、Cookie 或请求头送入渲染层。

学习任务先持久保存候选和来源，人工审核才写停用意图包，启用仍是单独动作。商品来源另由collected-products.ts复用本地商品服务，在页游标提交前新增停用商品，已有平台编号不覆盖；逐次复核身份、工作区与取消状态，失败重试幂等。local-runtime在初次学习身份核验前为尚未打开的拼多多店铺建立正常适配器，保持原登录分区与发送批准门。平台订单保留查询范围及完整性，未知退款和未验证时间保持空值；本机接待统计不冒称平台经营全量。相关契约为 `platform-learning.ts`、`platform-orders.ts` 和 `platform-operations.ts`。

接待规则与定时器只生成待批准事项，不自动执行平台动作。一次批准绑定本店、本买家、页面与具体内容，结果未知不可重发。`PlatformWriteCoordinator` 将原有文字发送、会话定位和复核纳入同店队列；平台操作使用已捕获的内部方法，避免重入死锁。人工切换或新消息使旧基线失效；独立调用 provider 未接共享互斥时还要求该店 AI 已暂停。转接请求匹配既有本店/全局人工关键词，目标必须来自平台当前可转接名单，未知在线状态不标为在线。

托管业务错误通过封闭 `{ok,data|error}` envelope 跨过 Electron，平台层解包后供团队和计费模块使用。401 同账号终态保留错误码，成功数据仍要求原账号登录有效；响应原文和凭据不序列化到界面。服务端配置与商户验收见 `server/BILLING_DEPLOYMENT.md`，本轮实测状态见 `REMAINING_FEATURES.md`。

## 桌面隔离

逐字输入策略和默认速度由 dom-text-adapter.ts 管理，页面 hook 只负责字素分割、逐步 DOM 输入及局部状态检查；引擎发送时传入 isCurrent 函数，主进程监听并通过原有取消令牌中止输入，不把函数传入 IPC。长文本超时包含预计输入时长，点击与回显仍复用原单次发送路径。

拼多多审批使用生成前的 pageReview 基线与确认时的 reviewHistory，不依赖 conversationHistory 私有 HTTP 接口。electron/conversation-review.ts 只比较页面实例、买家、有序正文及媒体；原始对话仍用于模型和归档，但 ID/时间元数据更新不属于新消息。临时读取失败保留 pending，跨窗口确认结束前再检查候选仍归属当前 pending，防止异步复核覆盖另一窗口结果。

electron/dom-text-adapter.ts 负责本工程拼多多文字发送策略，在 adapterFactory 装配点复用原页面桥并替换 sendText。DOM 定位、写入、点击前校验和回显验证在平台页面 hook，按钮事件仅发给对应 WebContents；不在 Vue 组件访问平台 DOM，不用屏幕坐标或系统鼠标。其他平台维持各自适配器。

实时日志与审批由 electron/review-console.ts 管理，仅保留本次运行的有界内存，通过原业务快照与事件同步。local-runtime 在统一发送入口注入待确认门，日志独立窗口复用窗口工厂、受信来源检查与 preload，不让原生平台 WebContentsView 遮挡确认界面。命令 open-runtime-logs 只打开应用内 /logs，review-reply 仅接受候选 UUID 与批准布尔值；渲染层不能直接调用发送适配器或修改候选正文。流程见 RUNTIME_LOGS.md。

`shared/contracts/desktop.ts` 与 `shared/contracts/backend.ts` 是渲染层与桌面的类型边界；渲染层经 `getDesktop()` 调用。窗口控制 IPC 保留原方法名称，主进程负责来源及参数验证。preload 单独打包为 CJS，在 sandbox 环境运行。

浏览器预览的窗口能力不执行原生操作；真实接口错误应在调用入口反馈。不要把 BrowserWindow 或 ipcRenderer 传给页面。

## 本机模拟店铺

模拟店铺不是独立的假聊天：平台 id `sim-local` 经上游 `createBackend` 的可选 `extraPlatforms` 注入点进入平台白名单（未注入时上游行为不变，补丁见 vendor/PROVENANCE.md），随后完全走既有链路 —— 适配器 → 上游 ingest → 采集监控 → 会话快照 → 回复引擎 → 逐条确认门 → `send-reply` → 适配器 `sendText`。

- electron/sim-hub.ts 是模拟数据的唯一持有者：每店一组顾客（默认三位）与消息线程，写入本机工作区的 `simulator-stores.json`，事件按序号单调递增供采集监控增量拉取；容量有界（事件 600、线程 200）。
- electron/sim-adapter.ts 实现适配器契约，把 hub 的线程转成上游会话与消息；`sendImage`/`sendVideo` 明确失败，`reviewHistory` 明确回答“模拟店铺没有平台网页，无法做网页复核”，不伪造能力。
- electron/sim-manager.ts 只对 `sim-local` 覆写门店状态：打开即在线，且刻意不声明 `authenticated`（没有登录就不假装登录）；其他平台全部委派上游 manager。
- electron/sim-server.ts 是主进程内的回环 HTTP 服务：仅监听 127.0.0.1、仅服务模拟店铺、仅在一次运行内有效；一次性口令只存主进程内存并随用户复制的链接下发，`/api/*` 全部校验，页面响应带 CSP 与 `no-store`/`nosniff`，请求体与字段长度有上限。端口占用时列出占用端口并如实失败。
- electron/sim-page.ts 返回整份自包含页面（无外部资源、动态文本一律 `textContent`），SSE 仅作为“有变化”信号，失败降级为轮询，口令失效即停止重连。
- IPC 只有两个入口：`sim:status` 与 `sim:open-page`（都要求受信应用主框架）。打开页面时会先打开店铺以启动采集，并返回带口令的地址；渲染层不接触 HTTP、端口或口令本身。
- src/modules/simulation 的客服台只经 shared 契约与模块服务使用这两种能力，会话与回复使用既有的 `select-conversation` / `send-reply` 命令，因此“逐条人工确认才能发送”对模拟店铺同样生效。

诚实边界：模拟店铺的消息只写在本机记录里，不连接真实平台、不产生真实买家，也不代表平台已送达；界面与页面都必须写明这一点。

## 闲鱼网页版店铺

闲鱼通过同一个 `extraPlatforms` 注入点进入平台白名单（`xianyu`），页面仍由厂商 `ShopWindowManager` 按 desk-v1 的入口 `https://www.goofish.com/im` 建 `WebContentsView`，不另开独立窗口；`electron/local-runtime.ts` 用 `vendorManager.webContentsOf(storeId)` 把同一页面交给本工程适配器。

- `vendor/xianyu-bridge/bridge.js` 是从用户提供的 kb-port 原样复制的桥接脚本（版本 v59，来源与哈希见同目录 PROVENANCE），只向 goofish 页面注入；不修改 `vendor/lingtu-runtime` 的哈希清单。
- `electron/xianyu/bridge-client.ts` 提供 Electron 传输层：给页面补 `window.ipc.postMessage` 最小 shim，请求与回包按 id 配对，事件（如商品清单捕获）经有界收件箱交给宿主；页面导航后重新注入，非 goofish 页面拒绝注入。
- `electron/xianyu/adapter.ts` 实现适配器契约 v2：readiness 登录/验证判断、待回复会话发现、会话切换、历史读取、文字/图片发送与重读核对、当前会话事件采样。闲鱼没有平台 msgId 与绝对时间，消息身份用「时间标签 + 组内序号」合成，按 HH:MM 换算当天时间仅用于排序；不碰 WebSocket，也不自行实现 MTop 签名。
- “待回复”以会话里最后一条是我方消息之后的新买家消息为准；`discard` 按 msgId 记住已处理批次，避免同一批消息重复生成。同名「买家 × 商品」多会话由页面 `activateChat` 按未读/当前项挑选，判不定就报 ambiguous，不猜。
- 登录态只来自页面 readiness：未登录、验证滑块、连接断开分别返回 `hook_not_ready` 并保留内嵌页面；未检查时为 `null`，不显示为已登录。登录完成后需要重新点开店铺触发一次健康检查。
- 诚实边界：商品采集/学习、视频发送、未打开会话的全局消息监听尚未接入；`drainEvents` 只采样当前打开的会话，AI 轮询 `popPending` 时会顺带激活待回复会话。

## 导航与兼容

路由仍用 hash，兼容 Electron 的 file 加载。既有路由和重定向保留：旧 `/shop/home` 兼容跳转到 `/shop/manage?panel=home`（不再有独立营销首页组件），`/store-sync` 回到店铺列表；配置中心的 `?panel=` 参数选择注册面板，`transfer`/`welcome` 旧键打开接待向导对应步骤，已删除的 `sync`、`learn`、`supervise`、`drill` 回落到店铺列表，其他非法值也回到店铺页。

菜单、标题与组件由 `app/navigation.ts` 注册。新增面板时在此登记，并为模块公开入口添加导出。当前不做真实鉴权守卫；接入登录时需一起设计会话恢复与失效行为。

样式采用旧 CSS 与原 data-v 标记兼容，新样式使用局部作用域和 tokens。删除兼容样式必须检查受影响路由与弹窗截图。

## 平台网页临时缩放

工作台顶部通过受限 business:store-zoom IPC 调整注册适配器的 WebContents，支持75–200整数百分比。校验可信主frame、当前workspace和店铺成员；渲染层不传webContentsId或URL。使用Electron43原生setZoomFactor/getZoomFactor，不添加依赖或修改vendor。缩放不保存到店铺配置，重新打开店铺恢复100%；Chromium同一分区同源页面可能共享缩放。

## 商品目录查询与本地商家编码

主进程createProductCatalog复用原商品知识分页，公共execute对list-products及set-product-codes作受限装配；编码独立JSON按店铺隔离（共用本机工作区，不再按软件账号拆分），写锁+revision CAS+商品版本检查后原子提交。前端商品服务解析严格目录契约，组件只用领域服务。原产品结构、模型检索及CSV格式不变，无新依赖或vendor补丁。

后续平台编码修正：目录merchantCode和platformDetail来自platform-product-store店铺隔离侧档，旧本机编码不再显示为平台编码，旧set-product-codes明确拒绝且保留旧文件。pdd-learning-provider通过原生商品编辑入口只读导航，platform-product-dom及platform-product-observer分别读取表单与固定原生详情响应，platform-product-merge按规格组合核验后保存。没有新IPC或vendor修改；平台页面仍无应用preload，未知字段不补造。

createProductSpecContext装配于正式AiClient及训练共用prepareModelContext，在既有通用表达和token计量之前选择本店enabled商品的匹配SKU；来源仅作user数据块，静态约束保留系统优先级。旧商品全文命中被受核验规格替换，意图资料及图片仍保留；未指定/未知/歧义规格要求澄清。工作区变化或取消后不继续发模型请求，发送确认门不变。

Task4 review round1: source replacement now uses stable logical positions and removed source versions; original-file metadata is independent of immutable shared blobs. Optional `KnowledgeSource.removed` is excluded from learning/publication; optional `KnowledgeVersion.modelEvidence` retains owned image/page/tile evidence for human review and OCR or directly visible relationships for the dedicated editor evidence panel. Main-only helpers are `import-identity.ts` and `learning-evidence.ts`; no new dispatcher, transport, dependency or renderer environment access. Terminal cancelled/succeeded jobs cannot use uncertain recovery. Full/family backup and owner-level restore retain all source/version/evidence dependencies and original/import identity metadata.

2026-11-15 final integration: `local-runtime → knowledge/daily → existing collector` persists per-shop Beijing day claims and quiet jobs in the same SQLite. `WorkspaceRuntime.restoreKnowledge → prepareRestore → full runtime disposal → stopped-writer restore → same-account factory` owns reopen/recovery; ordinary knowledge IPC cannot replace files. Explicit restore returns/rebinds a new lease without changing configured model source or persisted send mode, respecting startup AI-off defaults. `knowledge/budget` uses Node worker_threads with the existing js-tiktoken codec and context count function; full low-level requests are rejected at16K before model I/O. No new dependency or renderer filesystem/network access.

2026-11-15：shops基础设置通过settings公开ReplyPacingSettings控件复用REPLY_PACING。主进程加载Config时修正低于1秒旧值，新配置1秒且保留已有合法间隔。生产调度timedTasksEnabled:false仅禁用独立定时任务，保留接待事件调度。

店铺AI恢复由electron/store-ai-preferences.ts与ai-state-restore.ts在主进程协调，接入local-runtime普通启动、平台身份事件及显式开关命令；共享店铺快照仅暴露可选恢复状态，不公开存储身份。知识库维护重建抑制恢复，规则与验证边界见AI_STATE_RESTORE.md。

2026-11-16（1.0.35）：详细日志通过现有 runtime 命令 clear-runtime-logs 清除有界内存中的已完成记录；不会删除持久化会话、批准候选或取消在途请求。Desktop 新增可选 isAlwaysOnTop/setAlwaysOnTop，preload 对应受信来源窗口 IPC win:is-always-on-top/win:set-always-on-top，布尔输入校验。日志窗以原生 app-region 拖动，工具栏 no-drag；无新增生产依赖。

## 单店知识备份与恢复（2026-11-17）

knowledge runtime 的既有 backup/restore-preview 请求新增可选 storeId，沿用既有受信窗口IPC及工作区租约；无新通道或依赖。repository.createBackup 在一致SQLite副本中通过 backup-store-scope 裁剪本店实际适用知识及必要证据，manifest scope 为 family/store 判别联合，旧无scope全库包保持兼容。包内任务、待学问题及无关导入元信息排除，完整原件可能包含其他商品行，预览披露。

单店恢复继续由工作区所有者停止写者，使用现有staging、恢复意图和回滚。共享身份克隆到本店隔离副本；只保留原本适用于本店的草稿、审核版本和历史，不通过恢复扩大其他店批准范围。外店依赖只核对不覆写，依赖缺失/变化拒绝恢复；其他店私有数据及解析内容保持。原全库与family路径保留在高级入口。

客服接管关键词入口复用现有ConfigStore与ReplyEngine D-07，保存命令在既有save-config白名单下增加MANUAL_REPLY_KEYWORDS屏幕标识；自有manual-reply-keywords helper在主进程规范化输入，vendor仅最小配置保存分支。快照新字段manualReplyKeywords默认空，旧数据兼容；没有新增IPC通道、依赖或独立暂停调度器。源代码出处与hash见vendor/lingtu-runtime/PROVENANCE.md。

## 关键词开关与自动保存（1.0.69）

接待界面把全局人工关键词与客服接管关键词并列展示，各自带开关；没有独立保存按钮。文本失焦与开关变更分别通过既有 `save-config` 业务命令的 `RECEPTION_KEYWORDS` 屏幕保存，主进程 `electron/reception-keyword-settings.ts` 负责严格解析、预期旧值检查和开关原子文件；`electron/local-runtime.ts` 串行化读改写并在快照中叠加开关字段。ConfigStore 的关键词原文保持不变。

厂商 `backend.cjs` 只新增可选 `resolveKeywordSafety` 注入点，ReplyEngine 每次读取配置时仅替换生效的 handoff/manual 数组；本店自定义人工词仍优先于全局开关，客服接管开关只停止卖家侧匹配。复用向导的 handoff 仍由向导最后统一保存，关键词设置自身独立自动保存；来源和哈希记录在 vendor PROVENANCE/source-files。

配置中心（2026-11-19）：/shop/manage 是 MainLayout 的子路由，复用工作台顶栏；ShopManageView 只负责下方功能导航和面板。配置时隐藏店铺侧栏，原生平台视图沿 route.path watcher 隐藏，回首页恢复。旧路由与 query 契约保持。

## 桌面版本检查（2026-11-19）

`electron/app-update.ts` 查询固定官方 GitHub 仓库的最新正式 Release；`app:check-updates` 经桌面可信主 frame 校验后调用，不接受任意 URL。使用 Electron 网络栈、15 秒超时及 256 KiB 响应上限，不发送账户凭据。每进程自动查询一次（失败同样缓存），用户可手动重试，并发请求共用查询。只有合法三段版本、非草稿/预发布且包含对应 Windows 安装包的较新版本才提示。

主工作台左下的 `UpdateStatus` 提供检查入口和可关闭的小提示；仅在用户点击后经已有 `openExternal` 打开固定官方版本下载页，不自动下载或执行安装器。此功能不等于静默升级或代码签名。无正式 Release、网络失败与已是最新版本分别处理。浏览器仅预览界面，不进行启动检查。

## 知识库内容区（2026-11-19）

`/knowledge` 与 `/shop/manage` 同为 MainLayout 子路由，知识库传入 `embedded=true`，复用主顶栏和内容区。`createKnowledgeWindow` 的 embedded 宿主沿用原上下文/账号校验及维护重建契约，不创建额外 BrowserWindow；`knowledge:navigate` 仅向主窗口发送账号和固定 library/home 目的地，由 app 层导航并过滤迟到账号事件。原知识查询/命令 IPC 不变。路由离开由 controller 保存草稿并阻止失败或处理中离开，卸载继续注销事件和轮询；后台任务保持运行。独立窗口宿主保留给历史隔离验收。
