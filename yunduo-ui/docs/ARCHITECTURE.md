# 架构导航

## 启动链路

浏览器：`index.html → src/app/main.ts → App.vue → router.ts`。
桌面：`electron/main.ts → windows.ts → dist/index.html`；`ipc.ts` 注册能力，`preload.ts` 只暴露 `DesktopApi`。构建后的桌面文件位于 `dist-electron`。

## 目录与职责

| 目录                      | 职责                                     |
| ------------------------- | ---------------------------------------- |
| src/app                   | 入口、布局、路由、菜单注册和演示服务装配 |
| src/modules/workbench     | 工作台、快捷回复和定时任务界面           |
| src/modules/account       | 登录、账号、团队和店铺登录弹窗           |
| src/modules/shops         | 店铺、商品及相关弹窗                     |
| src/modules/reception     | 转人工、欢迎语、自动操作、图片识别       |
| src/modules/knowledge     | 意图、知识、模型定制和训练               |
| src/modules/quality       | 工单、质检和售后预警                     |
| src/modules/billing       | 充值、订单、算力与账户聚合界面           |
| src/modules/settings      | 软件偏好和设置                           |
| src/modules/auxiliary     | 辅助中心、聚合后台、助手及弹层           |
| src/shared                | 类型契约、桌面适配、图标、公共 UI        |
| src/styles/legacy         | 还原样式兼容层，不直接重生成             |
| tests / electron/smoke.ts | 逻辑测试 / 真实桌面冒烟                  |
| artifacts                 | 忽略的源码备份、截图和测试报告           |

跨模块只经公开入口导入组件。账户聚合依赖账号与设置属于现有界面组合；后续新增业务逻辑应放回各自模块，避免将 billing 扩展为全局业务中心。

## 数据与接口

electron/conversation-context.ts 在主进程按店铺和买家读取最新归档，合并平台历史/当前批次并排序去重，再交给 AiClient 与统一压缩器；不再受上游 mergeThread 最近 20 条限制。local-runtime 注入 resolveConversationThread，backend 仅转接给 modelClient.resolveThread；未注入时上游默认行为不变。历史上下文不改变当前批次的诊断引用和审批网页基线。

message-diagnostics.ts 将采集消息与引擎 decision、正式请求 submitted、生成结果及确认状态关联；只输出 LogEntry.ai DTO，不把 worker 的 Set/Map 或运行时对象传给渲染层。证据早于采集日志时使用有界缓存补关联，不同店铺/买家/真实消息 ID 隔离。SettingsView 的 REPLY_PACING 是现有配置命令的受限适配，秒/毫秒转换和旧值检查在后端完成。

共享 review 契约增加可选 startedAt/completedAt/durationMs，兼容旧记录。正式回复时长由 AiClient.reply 入口和正文完成点的单调时钟差提供，trace 接收时不重新计算发送阶段耗时；摘要回合在 ReviewConsole 中独立计量，计时 Map 随最多 40 条 trace 淘汰及退出清理。正常 reply:throttled 在用户日志入口过滤，不修改引擎节流。

上下文在 AiClient 完整组装 messages 后交给注入的 electron/context-compression.ts：16K 估算触发，原系统及近期消息保护，使用当前模型摘要旧资料，正式请求目标 8K。摘要与正式请求各自 trace，review 契约携带计量与摘要元数据；待发送候选只关联正式回复 trace。全程不新增 IPC 或跨会话摘要缓存。细节见 CONTEXT_COMPRESSION.md。

桌面由 electron/local-runtime.ts 装配固定的 vendor/lingtu-runtime 本地后端，模型模式始终为 local。electron/business-ipc.ts 提供白名单 snapshot/execute/event；共享契约校验输入和快照，过滤密钥等非公开字段。

渲染层由 shared/platform/backend.ts 适配桌面桥，shared/state/runtime.ts 的 Pinia store 共享快照、店铺选择及平台展示。模块组件保留自己的编辑草稿；商品服务在模块内转换分页和校验响应。真实保存使用后端版本检查，不将页面显示或夹具结果视为真实买家操作成功。

app/services.ts 兼容原有页面查询及浏览器预览，新增真实业务以 backend 契约为准，不继续向旧演示接口增加网络操作。未接线的 demo 工厂仅用于旧视图，不能用作真实 DTO。

数据与用户密钥都留在本机独立工作区；不接入上游账号/额度服务器。完整能力和使用步骤见 LOCAL_INTEGRATION.md。

## 桌面隔离

逐字输入策略和默认速度由 dom-text-adapter.ts 管理，页面 hook 只负责字素分割、逐步 DOM 输入及局部状态检查；引擎发送时传入 isCurrent 函数，主进程监听并通过原有取消令牌中止输入，不把函数传入 IPC。长文本超时包含预计输入时长，点击与回显仍复用原单次发送路径。

拼多多审批使用生成前的 pageReview 基线与确认时的 reviewHistory，不依赖 conversationHistory 私有 HTTP 接口。electron/conversation-review.ts 只比较页面实例、买家、有序正文及媒体；原始对话仍用于模型和归档，但 ID/时间元数据更新不属于新消息。临时读取失败保留 pending，跨窗口确认结束前再检查候选仍归属当前 pending，防止异步复核覆盖另一窗口结果。

electron/dom-text-adapter.ts 负责本工程拼多多文字发送策略，在 adapterFactory 装配点复用原页面桥并替换 sendText。DOM 定位、写入、点击前校验和回显验证在平台页面 hook，按钮事件仅发给对应 WebContents；不在 Vue 组件访问平台 DOM，不用屏幕坐标或系统鼠标。其他平台维持各自适配器。

实时日志与审批由 electron/review-console.ts 管理，仅保留本次运行的有界内存，通过原业务快照与事件同步。local-runtime 在统一发送入口注入待确认门，日志独立窗口复用窗口工厂、受信来源检查与 preload，不让原生平台 WebContentsView 遮挡确认界面。命令 open-runtime-logs 只打开应用内 /logs，review-reply 仅接受候选 UUID 与批准布尔值；渲染层不能直接调用发送适配器或修改候选正文。流程见 RUNTIME_LOGS.md。

`shared/contracts/desktop.ts` 与 `shared/contracts/backend.ts` 是渲染层与桌面的类型边界；渲染层经 `getDesktop()` 调用。窗口控制 IPC 保留原方法名称，主进程负责来源及参数验证。preload 单独打包为 CJS，在 sandbox 环境运行。

浏览器预览的窗口能力不执行原生操作；真实接口错误应在调用入口反馈。不要把 BrowserWindow 或 ipcRenderer 传给页面。

## 导航与兼容

路由仍用 hash，兼容 Electron 的 file 加载。既有路由和重定向保留；配置中心的 `?panel=` 参数选择注册面板，非法值回到店铺页。

菜单、标题与组件由 `app/navigation.ts` 注册。新增面板时在此登记，并为模块公开入口添加导出。当前不做真实鉴权守卫；接入登录时需一起设计会话恢复与失效行为。

样式采用旧 CSS 与原 data-v 标记兼容，新样式使用局部作用域和 tokens。删除兼容样式必须检查受影响路由与弹窗截图。
