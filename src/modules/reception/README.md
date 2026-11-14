# reception 模块

职责：转人工、进店欢迎、自动操作与图片识别配置。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：ShopOpsPanel、TransferSettings、WelcomeSettings、AutoSettings、ImageRecognizeSettings。

当前业务状态：ShopOpsPanel 保留分店/全局人工处理关键词、正文附加文字欢迎、全局超时配置和每店识图设置；另接独立平台事件规则和逐项批准组件。旧子组件保留为还原参考。平台能力由真实 provider 的当前证据决定，不根据本机归档补造访客、订单或客服名单。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。

## 2026-11-14 接待事件与审批调度

`electron/reception-automation-runtime.ts` 只接收主进程 `PlatformOperationsPort.observe` 的可信事件。催付规则为模板，订单号在事件匹配时绑定；规则拒绝固定订单号。欢迎最多一条文字及四项媒体，每项独立批准。规则保存含版本冲突校验，修改或停用使旧事项失效。`createFileReceptionAutomation({ directory, scheduler, encryption: safeStorage })` 在当前账号目录原子保存系统加密封装；系统加密不可用或文件损坏时拒绝降级、拒绝覆盖。

`electron/reception-operation-service.ts` 的 `ReceptionOperationsService({ workspaceId, stores, scheduler, automation, port, isCurrent? })` 提供 `snapshot/execute/poll/start/pause/invalidateStore/dispose`。`start` 启动调度并每分钟读取平台事件；到点只产生待批准事项。`snapshot` 刷新真实店铺、买家、订单及客服选项。公共 IPC/preload 生命周期由统筹装配；渲染层仅用 `ReceptionBridge.receptionSnapshot/receptionExecute`。不能将 `observe`、任意 URL/文件或任意平台函数暴露给渲染层。

`electron/reception-operation-executor.ts` 在批准时同步消费随机 `approvalId` 并先落盘 `executing`，随后串行复核、执行。新消息、账号/页面/买家变化、人工草稿、付款、客服离线、停店及过期应使旧事项失效。状态为 `pending/blocked/executing/confirmed/failed/uncertain/invalidated/cancelled/expired`；确认必须有平台证据。重启取消待批准事项、执行中转待核对，不恢复批准。未知结果不得重新准备或发送，相同未知事件超过24小时仍不重建，只能通过只读 `inspect` 核对。改变任务、规则或服务生命周期也会停止旧 guard。

`electron/pdd-operations-provider.ts` 复用现有拼多多登录分区、`readIdentity/reviewHistory` 和已配置逐字 DOM `sendText`。注册 `mallId` 必填，必须与读取到的平台身份相同，每次 guard 还核对最新注册身份；缺失或不符均阻断。只读字段以实页观察到的 `#app.__vue__.$store.state.currentUserInfo/chatList`、`mall_cs`、`status=read` 和可写的 `#replyTextarea` 为依据；官方页面组件代码确认原生消息 `type=0/1/14` 分别为文字/图片/视频，视频 `info.status=1` 不可确认。文字还须准确新增卖家服务器消息ID及完整会话变更相符，乐观UI回显不算送达。正式装配的 `withExclusive` 必须与旧接待的发送、定位、历史读取共用同一写锁；没有共同锁的独立接入在AI开启时要求先暂停，不自动关闭。

实页确认卖家 `from.uid` 是店铺编号，不能当客服编号。读取实时身份后要求 `state.userInfo.id` 与账号身份一致、mallId一致，文字/媒体还须 `from.cs_uid` 非空且等于已绑定的本客服 `userInfo.cs_uid`；未知或其他客服的相同内容不确认。该客服标识纳入批准基线；原生转接/催付、图片change及视频lease都在写入前再次复核身份与消息，期间变化立即阻止写入。

图片使用唯一原生图片 input 的单次 change（JPEG/PNG），按准备时的原生或DOM历史来源复核，禁止旧全页媒体计数和 paste/drop 双触发。`electron/pdd-native-video.ts` 通过原生 `middlePanel.queryVideoList` 等待全新数组读取审核通过的视频；`mediaAssets` 受限快照供规则/调度下拉选择，不能把通用文件 input 当视频。视频prepare保存页面内一次性素材证据，执行只调原生 `sendVideo`；callback只是请求受理。图片/视频均要求同买家、明确服务器确认的新卖家消息ID，以及资源类型/大小/SHA-256全一致。公网 HTTPS 媒体下载固定已验证 DNS、拒绝私网、重定向和凭据，图片最多10MiB，视频最多100MiB，待批准内存总量100MiB；视频批准前再次核对远程素材指纹，批准有效期最多5分钟。

`electron/pdd-native-operations.ts` 从实页证实的 `type41/template_name=user_source/info.title=当前用户来自…` 读取进店来源，只有同会话 `hasMore=false` 的完整原生历史、0条实际用户内容、原始msg_id/ts且10分钟内的新鲜事件才生成无消息访客；机器人type31不当访客。转人工由新鲜原生用户文字命中本店有效人工关键词触发，名单本身不生成请求。原生可转接名单返回 `online:null/canTransfer:true`，不编造物理在线；prepare/execute复核单买家原生弹窗和准确客服，转接只接受同socket、request_id及move_conversation成功回执。

原生催支付订单必须来自当前买家的已完成个人订单查询和同一orderInfo对象；全店未付款列表不能借当前聊天UID推断买家。prepare要求用户已在平台催支付弹窗选好条款，原生 `validData` 复核后才生成准确改价/发货承诺/特权费用说明；不会自动选优惠、开通特权或签约。执行复核相同订单和条款，原生send请求及服务器sentTypes均须是批准的完整合法条款集合。自定义规则文字只是备注，不另发聊天消息。缺少真实待付款对象时明确显示当前限制，不伪造订单ID或用普通聊天代替催支付。

实际只读验收已核对文字/图片入口、原生访客来源结构、可转接名单及39个审核视频素材；实店当前没有待付款对象，原生催付提交与转接回执仅用脱敏夹具验证。未进行任何真实发送、上传、催支付或转接。平台转码改变资源指纹、页面切换或回显无法读取均保留待核对，不重发；不以夹具通过宣称实店写入已验收。

公开 UI `OperationApprovalPanel` 每次显示一项目标与最终内容，支持取消和只读核对；ShopOpsPanel 内嵌规则、能力及证据状态，媒体最多四项可预览。定时任务弹窗只从真实平台事实中选店铺/买家/订单/客服，不接受手填事实ID。复用 Vue/Element Plus、RuntimePanel、现有样式、系统加密和 Node 标准库，未新增第三方依赖或修改 vendor。验证仅覆盖 reception/operation 直接相关测试、类型及文件静态检查，真实平台写入必须由用户逐项批准。
