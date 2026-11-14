# 架构导航

E:\~1awucheng\Plastic SCM\AI电商客服软件\client 是当前工作区的独立项目根，完整目录与文件边界见 PROJECT_LAYOUT.md。所有工具从此根执行；.github/workflows/lingtu-ai-desktop.yml 也从仓库根运行 npm，不再设置外层 yunduo-ui 工作目录。客户端实际运行依赖本工程 vendor，独立服务端保存在本工程 server，不引用兄弟工作区。

## 启动链路

并行整合新增的持久化、桥接和生命周期：local-runtime 在当前 managed.dataDir 下持有 ReportingPipeline、StoreSync 和 ReceptionScheduler；随机 workspaceId 只作为请求租约，不作为持久文件定位。工作区包装器逐次解析当前实例并丢弃切换后的晚到结果。main 统一注册 custom-phrases、store-sync、scheduler IPC；preload 仅暴露固定窄方法。报表跟随已采集事件及审批状态观察；调度在认证变化时启停，未验证平台能力保持 blocked，不具备绕过批准的发送方法。托管团队/计费通过 managed-business 严格路径和方法白名单复用设备会话，令牌不进入渲染层；Go 两领域注册到同一 clientAuth 后。详见 docs/parallel/INTEGRATION.md。

浏览器：`index.html → src/app/main.ts → App.vue → router.ts`。
桌面：`electron/main.ts → windows.ts → dist/index.html`；`ipc.ts` 注册能力，`preload.ts` 只暴露 `DesktopApi`。构建后的桌面文件位于 `dist-electron`。

## 目录与职责

| 目录                      | 职责                                            |
| ------------------------- | ----------------------------------------------- |
| .github                   | 独立主项目的云端检查与 Windows 构建，只上传产物 |
| electron                  | Electron 主进程、preload、业务运行时与平台接入  |
| server                    | 独立托管 API、原生管理网页覆盖层与运维说明      |
| vendor/lingtu-runtime     | 固定来源的客户端运行依赖与许可                  |
| src/app                   | 入口、布局、路由、菜单注册和演示服务装配        |
| src/modules/workbench     | 工作台、快捷回复和定时任务界面                  |
| src/modules/account       | 登录、账号、团队和店铺登录弹窗                  |
| src/modules/shops         | 店铺、商品及相关弹窗                            |
| src/modules/reception     | 转人工、欢迎语、自动操作、图片识别              |
| src/modules/knowledge     | 意图、知识、模型定制和训练                      |
| src/modules/quality       | 工单、质检和售后预警                            |
| src/modules/billing       | 充值、订单、算力与账户聚合界面                  |
| src/modules/settings      | 软件偏好和设置                                  |
| src/modules/auxiliary     | 辅助中心、聚合后台、助手及弹层                  |
| src/modules/simulation    | 本机模拟店铺客服台与会话回复界面                |
| src/shared                | 类型契约、桌面适配、图标、公共 UI               |
| src/styles/legacy         | 还原样式兼容层，不直接重生成                    |
| tests / electron/smoke.ts | 逻辑测试 / 真实桌面冒烟                         |
| artifacts                 | 忽略的源码备份、截图和测试报告                  |

跨模块只经公开入口导入组件。账户聚合依赖账号与设置属于现有界面组合；后续新增业务逻辑应放回各自模块，避免将 billing 扩展为全局业务中心。

## 数据与接口

六步店铺助手见SHOP_SETUP_WIZARD.md：shops/setup-rules复用已有模型方案命令，克隆保留原规则后仅绑定本店，不新增持久化格式、IPC或第三方依赖；助手字段以有版本的自有区块存入提示规则，完整校验及关闭条件清理后才保存。App在助手可见时将背景路由设为inert，避免键盘穿透；原生页仍由MainLayout统一隐藏。

店铺侧栏与新手引导见SHOP_SIDEBAR_SETUP.md。App挂载shops公开的ShopSetupGuide，MainLayout在引导可见时隐藏原生平台页；引导状态按当前workspace/store临时绑定，切换后取消晚到登录。新增open-store-backend走既有业务命令通道，经electron/store-backend校验权限和店铺后复用受限assist-platform-host固定首页，不接受渲染层网址，不新增任意导航IPC。

shared/customer-service 保存内置 80 条通用改写及纯检索函数，workbench 快捷回复按场景浏览并通过受控 copyGenericPhrase(id) 复制。主进程 generic-phrases.ts 以最新买家文字召回最多 3 条静态表达，先加入用途限制与使用条件，再交给原压缩器计量；正式回复/训练均经 local-runtime 的同一装配。来源、IPC 与事实边界见 GENERIC_PHRASES.md。

electron/conversation-context.ts 在主进程按店铺和买家读取最新归档，合并平台历史/当前批次并排序去重，再交给 AiClient 与统一压缩器；不再受上游 mergeThread 最近 20 条限制。local-runtime 注入 resolveConversationThread，backend 仅转接给 modelClient.resolveThread；未注入时上游默认行为不变。历史上下文不改变当前批次的诊断引用和审批网页基线。

message-diagnostics.ts 将采集消息与引擎 decision、正式请求 submitted、生成结果及确认状态关联；只输出 LogEntry.ai DTO，不把 worker 的 Set/Map 或运行时对象传给渲染层。证据早于采集日志时使用有界缓存补关联，不同店铺/买家/真实消息 ID 隔离。SettingsView 的 REPLY_PACING 是现有配置命令的受限适配，秒/毫秒转换和旧值检查在后端完成。

共享 review 契约增加可选 startedAt/completedAt/durationMs，兼容旧记录。正式回复时长由 AiClient.reply 入口和正文完成点的单调时钟差提供，trace 接收时不重新计算发送阶段耗时；摘要回合在 ReviewConsole 中独立计量，计时 Map 随最多 40 条 trace 淘汰及退出清理。正常 reply:throttled 在用户日志入口过滤，不修改引擎节流。

上下文在 AiClient 完整组装 messages 后交给注入的 electron/context-compression.ts：16K 估算触发，原系统及近期消息保护，使用当前模型摘要旧资料，正式请求目标 8K。摘要与正式请求各自 trace，review 契约携带计量与摘要元数据；待发送候选只关联正式回复 trace。全程不新增 IPC 或跨会话摘要缓存。细节见 CONTEXT_COMPRESSION.md。

桌面由 electron/local-runtime.ts 装配固定运行时，默认 local，可按公开来源配置显式选择 managed。managed-controller 复用受限设备会话协议，按服务/已验证账号定位独立数据与平台分区；模式/账号切换需停 AI 并重启。server/ 独立保留 Go 与原生管理网页，不替换 Vue。business-ipc 继续提供白名单 snapshot/execute/event，契约过滤凭据；见 MANAGED_SERVICE.md。

渲染层由 shared/platform/backend.ts 适配桌面桥，shared/state/runtime.ts 的 Pinia store 共享快照、店铺选择及平台展示。模块组件保留自己的编辑草稿；商品服务在模块内转换分页和校验响应。真实保存使用后端版本检查，不将页面显示或夹具结果视为真实买家操作成功。

app/services.ts 兼容原有页面查询及浏览器预览，新增真实业务以 backend 契约为准，不继续向旧演示接口增加网络操作。未接线的 demo 工厂仅用于旧视图，不能用作真实 DTO。

local 模式资料与服务商密钥留在本机独立目录，模型请求交给用户配置的服务商；managed 模式使用显式配置的账号/额度服务，只加密保存受限会话。调用所需上下文发往选定托管服务，不额外上传调试快照；原始本机资料不迁移进托管账号。完整能力和步骤见 LOCAL_INTEGRATION.md、MANAGED_SERVICE.md。

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

## 导航与兼容

路由仍用 hash，兼容 Electron 的 file 加载。既有路由和重定向保留；配置中心的 `?panel=` 参数选择注册面板，非法值回到店铺页。

菜单、标题与组件由 `app/navigation.ts` 注册。新增面板时在此登记，并为模块公开入口添加导出。当前不做真实鉴权守卫；接入登录时需一起设计会话恢复与失效行为。

样式采用旧 CSS 与原 data-v 标记兼容，新样式使用局部作用域和 tokens。删除兼容样式必须检查受影响路由与弹窗截图。

## 平台网页临时缩放

工作台顶部通过受限 business:store-zoom IPC 调整注册适配器的 WebContents，支持75–200整数百分比。校验可信主frame、当前workspace和店铺成员；渲染层不传webContentsId或URL。使用Electron43原生setZoomFactor/getZoomFactor，不添加依赖或修改vendor。缩放不保存到店铺配置，重新打开店铺恢复100%；Chromium同一分区同源页面可能共享缩放。

## 商品目录查询与本地商家编码

主进程createProductCatalog复用原商品知识分页，公共execute对list-products及set-product-codes作受限装配；编码独立JSON按账号/店铺隔离，写锁+revision CAS+商品版本检查后原子提交。前端商品服务解析严格目录契约，组件只用领域服务。原产品结构、模型检索及CSV格式不变，无新依赖或vendor补丁。

后续平台编码修正：目录merchantCode和platformDetail来自platform-product-store账号/店铺隔离侧档，旧本机编码不再显示为平台编码，旧set-product-codes明确拒绝且保留旧文件。pdd-learning-provider通过原生商品编辑入口只读导航，platform-product-dom及platform-product-observer分别读取表单与固定原生详情响应，platform-product-merge按规格组合核验后保存。没有新IPC或vendor修改；平台页面仍无应用preload，未知字段不补造。

createProductSpecContext装配于正式AiClient及训练共用prepareModelContext，在既有通用表达和token计量之前选择本店enabled商品的匹配SKU；来源仅作user数据块，静态约束保留系统优先级。旧商品全文命中被受核验规格替换，意图资料及图片仍保留；未指定/未知/歧义规格要求澄清。工作区变化或取消后不继续发模型请求，发送确认门不变。
