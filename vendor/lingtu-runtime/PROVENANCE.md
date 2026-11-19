# 上游来源与维护边界

## 2026-11-18：PDD 新商品卡来源最小修复（1.0.66 / hook v15）

事实边界：实店验收侧后续报告 1.0.65 A/B 真实收发通过，已覆盖下方 1.0.65 诊断节的旧未通过状态；本隔离工作树没有访问该现场、Inspector、正式用户数据或旧工作树源码。新商品卡是否在实店到达、能否按正确 UID 进入新候选并显示，仍待实店新卡实测，不能由离线 GREEN 反推。

已有只读诊断证明 native type41 买家入口卡在 `message.info.goods_info.goods_id/goods_name` 有显式商品字段，type0 分享卡在 `message.info.goodsID/goodsName`；旧 `normalizeNode` 只读顶层，store `ingestConv` 和 DOM `scanBubbles` 也不携带同一 msgId 的商品字段。当前新纯文字 turn 的 product 为空是 expected unknown，历史卡不能补成当前咨询。

本轮只改 `desk-v1/src/injections/pdd-web-hook.js` 并升至 v15：

- 新增有界 `productOf(node)`：保留原顶层 `goods_id/goodsId`、`goods_name/goodsName/goods_title` 的优先级和字符串口径，再仅接受已观察到的 type41 `info.goods_info.goods_id/goods_name` 与 type0 `info.goodsID/goodsName`。新增路径只接受正安全整数或 6–32 位纯数字字符串 ID、字符串标题；不递归扫对象/文本/URL/JSON，不调用 `recommendGoods`，不按标题或联系人预览猜 ID。ID 与标题按单一来源原子取得：顶层 ID 不借嵌套标题，嵌套 ID 不借顶层标题，标题缺失留空。
- `normalizeNode`、`ingestConv`、`scanBubbles` 统一传递商品字段，并携带“原始 type0/41 且数值商品 ID 明确”的 `productCard` 证据；`drainEvents` additive 增加同卡 `goodsId`。DOM 仅从同 UID、同 native msgId 的 Vuex 条目取商品，且仍先通过既有 `identityUid`、`panelMatchesUid`、行 ID 和角色检查。
- 商品只写入该卡所属 UID 的新 pending row，ID/标题成对更新（新 ID 无标题会清旧标题）；title-only 元数据不能与旧 ID 拼接。仅对带 `productCard` 证据和 native msgId 的买家显式卡跳过文本去重，普通文字/legacy goods 文字仍用原去重；`bodyOf` 为 info-only store 卡补同来源标题后入队。bootstrap 历史卡、被水位/去重吸收的旧卡、纯文字、其他 UID 和角色未知行均不会回填。没有新增全局/跨请求商品缓存。
- 未改发送适配器、授权、节奏、窗口、知识业务、平台配置、`panelMatchesUid`、`reviewHistory`、`sellerEcho`、批准基线或新消息作废逻辑。

实际 sha256 与 targeted Electron 覆盖见 `source-files.json`、`docs/VALIDATION.md` 和本工程 ignored `artifacts/pdd-product-fix-20261118/worker-report.md`。当前离线结果不代表实店通过。`desk-v1/src/injections/pdd-web-hook.js` 实际 sha256 为 `39cada660756f6e85703102c6c0fd8eebe289210ceb5571552781ff23b827af1`；source-files 保留 `upstreamGitBlob` 与 `upstreamSha256`。

## 2026-11-18：PDD 发送诊断修复（1.0.65 / hook v14）

1.0.64 的 A/B 实店发送验收仍未通过，已有证据只到失败事实与可复现路径，不能写成已送达或已修复。B 在平台自带机器人回复后从 `todayChatFilter` 待回复分组消失；`conversationsOf` 只要 getter 分组中有任意其它 A 就提前返回，`conversationFor(B)` 为 null，尽管 `currentUserInfo`、原始 `state.chatList/todayChatList/searchChatList` 中存在 B 且 native msgID 正确。A/B 的底层发送均返回 `input_busy`，真实环境同时存在全屏 leave 弹窗覆盖发送按钮；16:57/17:15 的具体 detail 未落日志，不能武断归因，也没有 app 卖家回显或平台送达证明。平台自带机器人回复不是本软件送达。

本轮只做三个最小修复：

- `pdd-web-hook.js` 升至 v14：`conversationFor` 先走原 `conversationsOf`；仅目标精确 UID 缺失时，只读扫描原始 `todayChatList/chatList/searchChatList`。同 UID 多份候选的 latestMessageId **冲突**（含一份有 ID、一份无 ID）返回 null；单份或所有候选都无 ID 时不因缺失本身直接返回 null，而由 `panelMatchesUid` 的 current/listed latestID、行 ID、DOM/Vuex role 全量检查决定是否 fail closed；同 latestID 也不能跳过这些检查。`currentUserInfo` 从不作为单独归属证据。fallback 不扩大 `scanStore/conversationsOf` 的采集范围，但补到 `listed` 并通过归属验证后，可恢复当前目标的 DOM 采集，不是所有采集范围完全不受影响。
- `reply-engine.js`：只在既有 `reply:review-result` 和发送失败 `reply:failed` 事件中附带 exact allowlist 的 ASCII detail 分类码；未知/任意原文在 vendor 发 event 前变为固定 `unclassified`。reason、状态、授权、点击次数、不自动重发均不变。
- `shop-window.js`：只对 `pdd-web` 的 `WebContentsView` 设 `backgroundThrottling:false`，其它平台不传该键，保留 Electron 默认值。现场探针证明 PDD 子视图默认节流为 true、后台 rAF 被暂停；受控实验只在 wc2 临时关闭节流后 rAF 约 8ms 完成，恢复 true 成功，草稿哈希不变、无发送。该实验不能证明它是 16:57/17:15 的唯一根因，也未证明清掉 overlay；只证明关闭节流可恢复后台 rAF。未加全局 CLI flag，未改 opacity/style/弹窗/发送 guard。

实际 sha256（source-files.json 保留 upstreamGitBlob/upstreamSha256）：

- `pdd-web-hook.js` `b70f05981c92835885d78c59dfbb23573a208ee8b709c73149d9112c8762f84a`
- `reply-engine.js` `105a745721d46313fc9bbfd306f85c6d7ff938098b260597e7593ea97f37e491`
- `shop-window.js` `1655a231b9b979ffa66f2177e960f2432c93eb69d7cf4a27823907daa2aca73b`

隔离验证包括合成 UID 的 hook 用例、真实 StoreWorker/ReviewConsole 的 detail 事件与日志、以及真实 `ShopWindowManager` + 隐藏/覆盖窗口的 Electron rAF 对照；RED 原始 true 为 timeout，GREEN PDD false 为 rAF、非 PDD 仍 timeout。离线夹具、headless 与本地 Electron 结果不代表实店通过。**A/B 真实发送、覆盖弹窗期间的 hit/回显、新 hook 在实店的 UID/role 归属仍待 Codex 与实店独立验收。**

## 2026-11-18：PDD 真实消息行投影（hook v13，1.0.62 实店基线失败的后续修正）

1.0.62 实店基线在绑定店 wcId=2 的 A/B 两买家上均 `known:false`，首个 false 为 `dom_text_not_in_known_texts`。只读容器诊断证明 `BUBBLE_SEL`（`.chat-item p.chat-message-content, p.chat-message-content`）的可见命中全部是左侧联系人预览 `.chat-item-box[data-random]`，真实消息区是 `LI#middlePanel_list_<msgId>.clearfix.onemsg` 且不含 `p.chat-message-content`；原“右侧残留旧气泡/面板未切完”归因撤销。后续同店只读采样进一步证明 `DIV.merchantMessage` 在每条消息行都存在（买卖双方都有），不能作为卖家标记；方向由行内 `DIV.cs-item`（`from.role=mall_cs`）与 `DIV.buyer-item`（`from.role=user`）明确给出，正文/卡片/图片叶子为 `DIV.floor_item.text`、`P.msg-content-box`、`.good-name/.good-price/.good-part`、`.title/.content`、`img` 等，装饰含 `P.message-time`、昵称、`robot-text`、`menu_item`、`.btn`。

v13 只改 `desk-v1/src/injections/pdd-web-hook.js`：删除 `BUBBLE_SEL`，新增 `messageRows()/rowMessageId()/rowDomRole()/rowRole()/rowText()/rowContent()` 统一真实消息行投影；`panelMatchesUid`、`scanBubbles`、`reviewHistory`、`sellerEchoCount/waitForEcho` 与准备/确认发送共用该投影。有 `middlePanel_list_<msgId>` 的行由 ID 唯一证明归属，角色只认同一 msgId 的 Vuex `from.role`（DOM 方向标记仅用于归属冲突核对；`merchantMessage` 是公共包裹层，不能作为卖家证据）；正文优先用同一 ID 的权威普通文本，图片/视频 URL 与 JSON 卡片载荷不写进正文/指纹，退回已核实正文节点；只有历史无 ID 的 `.chatMessage` 行保留原严格文本归属兜底，不扩大到联系人预览。任一可见行角色无法证明时 `reviewHistory` 整体 `known:false`，不静默忽略后仍声称完整；新 seller 行先于 Vuex 时等待可信角色，超时按 `send_unconfirmed` 处理、不补发。真实行 ID 取代文本哈希用于 DOM 消息 ID，同文新消息因此改变序列；时间/昵称/机器人/菜单/按钮不进入正文。v11 的三路 UID 校验、v12 的未知方向不占水位与无 ID 文本证据规则均保留。

source-files.json 保留 upstreamGitBlob/upstreamSha256，更新该文件实际 sha256 与 localPatch。针对性 RED/GREEN 与命令、退出码、未验项见本工程 `docs/VALIDATION.md` 与 ignored `artifacts/pdd-live-fix-20261118/worker-report.md`。**1.0.62 实店基线未通过；1.0.64 仍待 Codex 独立复核与实店新消息/商品/发送验收，离线夹具不代表实店通过。**

## 2026-11-18：回复监控当前咨询商品标题（1.0.59 源码）

只读回复监控需要显示当前咨询商品的可靠标题，同时禁止从模型输出、推荐商品或其他买家/店铺猜测。reply-engine 在原有真实 reviewContext 中把平台待处理行已有的 goodsTitle 与 productId 一并交给 trace；标题来自平台页面/队列，不进入买家正文或发送决策。商品资料解析仍在本工程 TypeScript：ReviewConsole 只按同店精确 productId 查询现有知识绑定/平台详情，缺失时保留平台标题或仅显示编号，推荐商品、跨店同名标题和模型正文不会补位。未改变生成、人工确认、自动模式、发送复核、取消或重试语义。

source-files.json 保留 upstreamGitBlob/upstreamSha256，仅更新 desk-v1/src/main/reply-engine.js 的实际 sha256 与 localPatch。针对性验证：`npx vitest run tests/review-engine.test.ts` 8/8（含真实引擎 reviewContext.productId/goodsTitle 与零发送）、`tests/review-console.test.ts` 22/22、监控投影/组件测试通过；`npm run check:vendor` 与上游 reply-engine 测试待整合轮执行，未运行全量上游套件。

## 2026-11-17：欢迎延迟声明与附加元数据（1.0.52）

用户要求进店欢迎在批准后等待随机延迟再实际发送，默认 1～3 秒，可按店铺配置 1～3600 整数秒且下限不大于上限。store-welcome.cjs 只在既有严格欢迎记录中增加可选的 delayMinSeconds/delayMaxSeconds：默认 1/3，随文字、开关、版本和 enabledAt 写入同一条原子记录并共用版本 CAS，旧 version 1 迁移补默认值；显式越界、反序或非整数继续报错且不改写原文件，不增加旁路文件或两步提交。claim() 返回值保持原文字；新增 claimEntry() 同时返回已认领文字与版本。backend.cjs 的 welcomePolicy 在既有 observe 后提供 claimEntry。reply-engine 的 decorate 回调接收可变元数据对象，仅当欢迎文字确实位于最终正文开头时写入 meta.welcome={version}；候选通过既有 beforeSend 携带该可选字段，未注入 claimEntry 或普通回复不带任何欢迎信号，绝不按任意正文前缀猜测。

抽样、分块等待、取消复核和发送授权释放全部在本工程 TypeScript（electron/welcome-delay.ts、electron/local-runtime.ts）；vendor 不保存延迟业务规则。批准、PDD 发送租约、发送前频率/定位复核、逐条确认和图片/视频独立规则均未改动。source-files.json 保留 upstreamGitBlob/upstreamSha256，更新上述文件及欢迎回归测试的实际 sha256 与 localPatch。

针对性验证：node --test vendor/lingtu-runtime/tests/store-welcome.test.mjs 7/7；桌面欢迎延迟、真实厂商装饰、店铺同步与界面定向 vitest 通过；未运行全量上游套件。

## 2026-11-17：免费托管内部摘要

managed-session.cjs 新增主进程专用 summarize()，仅以现有鉴权会话 POST 固定 /api/client/chat/summaries；正文只包含 UUID 父回复 ID、已组装的不可信历史 JSON（上限 96KiB）与 1–7000 的 token 预算，不接受系统规则、模型或任意 URL，未知字段不进入正文。错误沿用现有 failure/epoch 语义，取消信号、20 秒请求上限与既有响应大小边界不变；config() 与 chat 的强类型策略透传、团队/计费白名单保持原样。该请求是服务端标记的 auxiliary（免费）请求，仍需登录与有效账号；客户端把摘要父 ID 绑定到紧接着的一次回复，服务端据此每笔回复只记一次内部摘要。source-files.json 保留 upstreamGitBlob/upstreamSha256，仅更新该文件的实际 sha256 与补丁说明。backend.cjs 未改动，回复侧的父 ID 复用由 electron/local-runtime.ts 在 managedChat 注入点完成。

针对性验证：桌面 managed-context、managed-billing-integration、managed-controller、managed-service-request 与既有 managed-context-policy/managed-context-transport 测试通过；未运行全量上游套件。

## 2026-11-15：审核知识仓储兼容注入

backend.cjs 只增加可选 knowledgePorts / knowledgeContext / onKnowledgeModel：在旧 JSON 构造前注入 SQLite 的完整兼容端口，统一审核检索，并将现有配置、密钥及托管计费所使用的完成器提供给本工程主进程。AiClient 的可选 completeKnowledge 在序列化审核依据时保留完整条目，继续交给现有16K/8K压缩器；未注入仍沿用上游16000字符路径。请求 trace 携带同次知识相关标识，生成返回 traceId，reply-engine 将该精确ID交到既有批准门，并把注入的当前性守卫延续至适配器输入/点击。外部 AbortSignal 可取消本机或托管请求。知识策略、SQLite、工作区校验和UI均在本工程 TypeScript，默认无注入行为保留。source-files.json 保留 upstreamGitBlob / upstreamSha256，仅更新这三个文件的实际 sha256 与补丁说明。

针对性上游验证：backend-integration.test.mjs、managed-backend.test.mjs、reply-engine.test.js 共87项通过；未运行全量上游套件。

## 2026-11-17：托管上下文策略读取与受限透传

managed-session.cjs 新增主进程专用 config()，仅以现有鉴权会话 GET 固定 /api/client/config；serviceRequest 的团队/计费白名单不变。chat 仅构造 client_request_id/messages 与可选 purpose/policy_version/learning_source，未知字段（包括客户端 max_tokens）不进入正文；旧正文语义不变。backend.cjs 仅从显式标记的 model.complete 输入转发学习用途、版本和来源，现有回复调用保持省略。策略投影由本工程 TypeScript 的 Zod 严格校验并在主进程缓存最多 60 秒；当前没有获批的直接详情页学习调用点，透传能力保持未启用。source-files.json 保留 upstreamGitBlob/upstreamSha256，仅更新上述两个文件的实际 sha256 与补丁说明。

独立复审补充：显式用途、版本或来源无效时，backend.cjs 在调用 managedChat 前直接拒绝，不降级为旧版聊天正文；仍保留三字段均省略的旧请求。客户端模型列表校验接受服务端可能返回的 259 字符显示名及其现有响应大小边界。

针对性验证：managed-session-context、managed-session-billing、managed-backend 与桌面 managed-context-policy/managed-context-transport 测试通过；未运行全量上游套件。

## 2026-11-13：用户授权新增可选托管装配

原本机装配仍默认保留；用户明确要求合并 PR #21 服务端后，云朵的 TypeScript 控制器复用已有 managed-session 和 managed 后端注入，不替换运行时或混用上游 React 桌面。backend.cjs 的唯一新增兼容点是把 complete 的可选 traceId 转交 managedChat 的本机 options，未写入 HTTP 正文；提交诊断由自有控制器在实际 chat fetch 前发出。原始来源与最新实际摘要保留在 source-files.json。账号隔离与新服务端来源见 docs/MANAGED_SERVICE.md 和 server/PROVENANCE.md。

来源：https://github.com/907609732/LTTLT-AI-Customer-Service/pull/18

固定提交：5b6293cc9c75e6e25fdaa16d6187effb0a9d1a5e。

本目录保存本地后端、平台适配器、回复引擎及相关回归测试的上游原始源码。使用上游 AGPL-3.0-only，保留 LICENSE、LICENSING.md 和 THIRD_PARTY_NOTICES.md。package.json 是本工程为模块解析添加的隔离元数据，不是完整上游构建配置。

不引入 React 界面，不启动旧 desk-v1 renderer，不连接上游账号/额度服务。应用入口和 IPC 适配由本工程 electron 下的 TypeScript 维护。只有用户在模型设置中明确保存的目标才用于模型调用。

此目录是第三方源码兼容例外：保留 JS/CJS 原貌及上游测试，不按本工程格式化或改写为 TypeScript。升级应固定新提交、比较差异、更新本记录并运行上游与集成测试。禁止把本工程新增业务代码放入此例外目录。

## 本地兼容补丁（2026-11-12）

会话上下文修订：backend.cjs 新增可选 resolveConversationThread，转接为 modelClient.resolveThread；reply-engine 在正式生成前优先调用该注入点，未注入仍保持上游 mergeThread。TypeScript 的 conversation-context.ts 负责按 storeId + uid 合并本机归档、平台历史与当前批次，不提前截取 20 条，统一交给现有压缩器；不改变发送确认及本轮消息归因。双哈希清单保留原始来源并更新实际哈希。

electron/backend.cjs 的 createBackend 新增可选 localVisionSupport 注入点，仅在 local 模式使用。云朵的 TypeScript 适配器注入 electron/model-capabilities.ts，让图片识别使用当前用户配置的模型，不再要求模型名为 qwen3-vl-plus。未注入时保留上游原行为；managed 模式不受影响。每店开关、版本检查和图片输入校验保持原有流程。

source-files.json 为此文件同时记录 upstreamGitBlob、upstreamSha256、本地补丁说明和实际 sha256。升级时必须重新审查此注入点，不能仅更新哈希；自有策略继续放在 TypeScript 中。

## 日志与确认注入点（2026-11-12）

消息诊断修订：reply-engine 给调度/跳过分支发出带原消息引用的 reply:decision，附在 reviewContext.buyers 中关联正式请求；确认门区分新消息替代，不误留 review 暂停。ai-client 在实际 fetch 前发出 submitted 并携带 traceId，摘要也传递对应 traceId。backend 仅增加 REPLY_PACING 对现有 config.update 的整数秒/旧值白名单适配。诊断策略、缓存及 UI 均在 TypeScript；双哈希清单已更新。

回复计时修订：ai-client.js 在 reply 入口记录墙钟开始与单调时钟，在正文清洗完成/请求失败时向已有 trace 提供 durationMs；空正文走错误 trace，不标为成功完成。只补充元数据，不改变请求和发送流程；用户日志节流过滤及摘要回合计时留在本工程 TypeScript。双哈希清单已更新。

逐字输入修订：pdd-web-hook v8 的 button 准备阶段支持可选 typeDelayMs，逐字素写入并发出对应 input 数据，逐步检查前缀、焦点、目标买家、网页消息与取消令牌；未启用选项的上游行为保留。reply-engine 只补充发送阶段的 isCurrent 取消信号。TypeScript 负责默认 50ms、预计超时及取消监听；点击守卫从输入完成后计时。原始及实际哈希随补丁更新。

确认误拦截修订：pdd-web-hook 升至 v7，新增只读 reviewHistory 读取当前买家的网页正文/媒体与页面实例，不依赖私有历史请求；reply-engine 在生成前（含转人工分支）采集可选 reviewHistory 基线并向确认策略提供读接口。未实现该扩展的其他适配器保留原流程。TypeScript 策略负责比较、重试和明确提示；双哈希清单随补丁更新。

上下文压缩注入：backend.cjs 新增可选 prepareModelContext，传给 AiClient.prepareContext，在完整 messages 组装后、实际请求与最终 trace 前调用；complete 新增可选 maxTokens 供摘要使用。仅在云朵装配中注入，未注入时保持上游原流程。上下文压缩失败转人工核对，避免自动反复生成；训练错误明确呈现。策略、tokenizer 与日志元数据仍由本工程 TypeScript 维护，源文件双哈希已更新。见 docs/CONTEXT_COMPRESSION.md。

本地 DOM 文字补丁：desk-v1/src/injections/pdd-web-hook.js 升至 v6，发送前比较完整正文，按钮只点击一次且不回退回车，文本不静默截断至 900 字，改为校验 1–2000 字；回显比较同步覆盖 2000 字。原始和实际哈希在清单中。prepareNativeTextSend 增加可选 button 模式，返回按钮在网页中的坐标并安装可信点击守卫；confirm/cancel 复用令牌和回显校验。生产策略位于 electron/dom-text-adapter.ts，只派发浏览器内部按钮事件，保留上游默认键盘模式。离线夹具验证可信点击，不代替实店验收。

- electron/backend.cjs：可选 onRuntimeEvent、onModelTrace 与 beforeSend 注入；接入确认策略时禁用超时兜底，并复用已有发送失败隔离处理。
- desk-v1/src/main/ai-client.js：可选 onTrace，只提供构造完成的 messages、排序对话、reviewContext、模型名、清洗结果及错误代码，不包含请求头和 Key。
- desk-v1/src/main/reply-engine.js：在统一发送入口的欢迎语装饰后调用可选 beforeSend，确认后复核状态、频率、会话定位及人工接管；拒绝时暂停该会话，不自动重发。事件记录最终发送结果。

新增策略、日志缓冲及状态机全部位于本工程 TypeScript；第三方只保留这些必要注入点。上游未传入这些选项时行为不变。三处文件均保留原始哈希、补丁说明及实际哈希，升级须复核统一发送边界。详见 docs/RUNTIME_LOGS.md 与 tests/review-engine.test.ts。

## 附加平台注入（2026-11-13）

本机模拟店铺：electron/backend.cjs 的 createBackend 新增可选 extraPlatforms，只把注入项合并进 allPlatforms（按 /^[a-z0-9][a-z0-9-]{0,39}$/ 过滤），用于 capabilities.platforms 快照与 add-store 的平台校验；未注入时 allPlatforms 与上游 platforms 完全一致，拼多多/抖店的默认清单、accessModeFor 与 createAdapter 表均未改动。云朵在 electron/local-runtime.ts 注入唯一一项 sim-local（本机模拟店铺），其适配器、门店管理器与模拟顾客页全部位于本工程 TypeScript（electron/sim-\*.ts）与渲染层模块 src/modules/simulation/。

此注入只放开“平台 id 白名单”，不给模拟店铺任何真实登录、真实买家或平台发送能力；模拟消息仍走上游同一套 ingest → 会话快照 → 回复引擎 → 逐条确认门 → send-reply 链路。source-files.json 中该文件的 localPatch 说明与实际 sha256 已随补丁更新（当前 fb2ffd7d531500a2579961ec282015b0ccd0657cf47c9325f68a18e180c158c6）。升级上游时必须重新审查该注入点，不能只更新哈希。

2026-11-14 用户要求本机 HTTP 预览：managed-session.cjs 的来源校验仅额外允许显式、带端口的 http://127.0.0.1。远程 HTTP、localhost 名称、伪装域名、路径及凭据仍拒绝；主进程同步校验。source-files.json 保留原始 upstreamSha256 和实际 sha256。没有关闭 TLS 校验或创建证书。

## 受限团队与计费会话适配（2026-11-14）

计费诊断增量：managed-session.cjs 的错误对象新增受限整数 HTTP status；仅保留允许列表中的错误 code，将代理非 JSON 404 明确识别为接口未部署，401 统一走既有登录失效流程，商户未配置等已知 503 不再错误地将账号置为 offline。未知正文和远端错误文本均不传出。路径白名单、加密会话、身份/epoch、大小限制、超时及既有模型不确定结果保护保持原语义。原始 upstreamSha256 保留、实际哈希已更新；原生 managed-session-billing 测试覆盖 404/401/未配置/冲突与无原文泄漏。

managed-session.cjs 新增主进程专用 serviceRequest，仅允许 /billing、/team、/teams 的受限路径和 GET/POST/PATCH/DELETE；拒绝路径跳转、查询串和过大正文。复用原 refresh、请求超时、epoch/退出校验，令牌不出主进程。TypeScript 策略和业务参数校验由 electron/managed-service-request.ts、managed-controller.ts 及领域服务承担。原始 upstreamSha256 保留，实际哈希已更新。新增 managed-controller 回归先失败后通过，后续须执行 vendor 完整性与上游验证。

## 1.0.13 受限知识图片兼容补丁（2026-11-16）

managed-session.cjs 与 backend.cjs 的托管视觉能力保留鉴权服务端给出的授权，不再要求连接别名必须等于上游模型 ID；服务端仍验证实际获准通道的上游模型。客户端不能自行授予视觉能力，店铺图片接待仍需原显式开关。双哈希及别名授权/拒绝回归同步更新。

shared/multimodal.cjs 仅为已验证知识图片允许规范 base64 PNG 分块，单图最多 8 MiB、1400×1400，总正文 16 MiB，非图片正文仍最多 128 KiB；买家 imageInputs 和公开图片 URL 继续仅 HTTPS。managed-session.cjs 仅提高 chat 正文上限，其他团队/计费请求边界不变。来源和原始哈希保留在 source-files.json，并记录本地实际哈希；完整上游 232 测试已通过。Windows OCR 及学习策略均在自有 TypeScript 中实现。

## 2026-11-16：会话定位最小兼容修订（hook v9）

真实拼多多页面复现 focusConversation 返回 ok 但当前买家未变：列表选择处理绑定在 mousedown，原实现只发 click。仅该定位方法补充 mousedown/up，沿用原 click，不修改全局发送点击工具；按 data-random 的完整买家 ID 匹配，DOM/旧 mutation 分支均核对实际 activeUid 后才报告成功。修复复用既有平台 hook，不引入新依赖。保留 upstreamGitBlob/upstreamSha256，更新本文件实际摘要与 localPatch。

tests/pdd-conversation-focus.test.ts 使用合成页面验证选择事件、忽略点击时不报成功及相似 ID 隔离。真实页面用修复后的原方法在两个已有买家间切换并核对 UID；没有发送消息，新收到消息的完整链路需另行观察，不用已有聊天重放伪造新消息。

## 2026-11-16：待审核与模型并发分离

实店日志确认托管 maxInflight=1 时，beforeSend 的审核承诺一直占用 inflight，新买家停在 max_inflight。reply-engine 仅在等待原 beforeSend 门期间释放模型处理名额，finally 恢复计数，保留 processing 对同一买家的独占、tasks/settle 退出等待和原发送复核。总保留任务上限为 maxInflight+32，避免无人审核时无限增长。未增加模型并发、批准或自动发送权限。只改既有兼容点，保留上游摘要与许可，更新实际摘要和 localPatch。

真实引擎与 ReviewConsole 联测新增：一位买家等待审核，另一位在 maxInflight=1 下生成候选，确认前始终零发送。

## 2026-11-17：客服接管关键词保存适配

backend.cjs 的既有 save-config 仅新增 MANUAL_REPLY_KEYWORDS 分支：按 keywords / expectedKeywords 解析并执行 trim、去空、去重、每词 1–30 字和最多 100 个校验，读取 config.all().safety.manualReplyKeywords 做旧值比较，冲突时拒绝，随后 config.update 只写 safety.manualReplyKeywords。同一规则也由本工程 electron/manual-reply-keywords.ts 在主进程保存边界执行，覆盖直接调用入口。卖家侧消息命中、selfSend 回环过滤、生成/待批准取消和显式恢复继续沿用上游 D-07 与既有注入点，没有第二套暂停引擎。source-files.json 保留 upstreamGitBlob / upstreamSha256，仅更新实际 sha256 与 localPatch 说明。

## 2026-11-17 本地遗漏改动整合

保留当前知识端口、用途/策略版本透传和取消链路，在拼多多消息、待处理队列及回复上下文透传 goodsId；精确商品ID优先，标题与问题检索去重后补充。hook版本从9递增到10，保留已有会话定位修复。backend仅新增可选 resolveManagedRequestId 注入，在记录失败诊断前确定摘要父回复ID，保证实际HTTP正文和诊断一致。保留原始来源哈希，更新实际文件哈希与对应回归测试。

## 2026-11-18：拼多多消息区身份与发送定位（hook v11）

实店日志显示两位买家交替消息时旧气泡被归到新选中的 uid，且卖家回显可能以 buyer 身份进入待回复；同时 reply-engine 的先定位与 adapter 发送是两次独立排队，中间可被另一位买家切走。`desk-v1/src/injections/pdd-web-hook.js` 升至 v11：DOM 采集和 `reviewHistory` 只接受 selectingChatUid、currentUserInfo.userInfo.uid 与列表实际选中项一致的会话；已知 Vuex 会话数据时，网页气泡必须对应当前买家 messageList 的已知内容，并校验 `middlePanel_list_<msgId>` 消息项 ID 全部属于该买家，currentUserInfo 与列表同一 uid 的最新消息 ID 不一致或列表缺少该买家时 fail closed，不再靠等待一帧假定新消息区已加载。结构化帧缺少发送方向时不再默认 buyer，而是作为系统消息吸收，避免卖家回显/其他通道消息进入买家队列。卖家 `merchantMessage` 判定保持原实现，未新增类名或几何猜测。

本工程 `electron/dom-text-adapter.ts` 在 PlatformWriteCoordinator 的同一次店铺 sendText 锁内，用配置时捕获的原始 focusConversation 重新定位本次 uid，再读取网页基线、填写、点击和回显；不重入协调队列，保留 isCurrent、候选授权、人工草稿与单次点击保护。定位失败或身份不确定时不发送、不重试。

针对性验证：新增 tests/pdd-conversation-attribution.test.ts（6 项）与 platform-write-coordinator 交错调度测试；在原始 v10 hook / 原发送实现上分别观察到 3 项错归属与 1 项发送失败，修复后通过。pdd-conversation-focus、dom-text-adapter、review-engine 等 58 项定向测试通过；未运行全量桌面套件。真实页面卖家气泡标记与 currentUserInfo 更新时序仍需现场观察，不能用离线夹具宣称实店已修复。

## 2026-11-18：组合复核补正（hook v12，在捕获的 v11 基础上）

整合 1.0.60 整理分支前，独立复核用权威 hook 和内存 JSDOM 复现了 v11 的两条遗漏，均在 PDD 会话归属链路内，按最小补丁修正后升为 v12；v11 的来源记录与上游双哈希保留在上节。

- 未知方向帧不再当作 system 吸收。v11 对无角色 WS 帧先写 seen 与 uid 水位，之后同一 msg_id 由 Vuex 补全 from.role=buyer/seller 时会被去重吞掉，后台买家可能漏回复。v12 将「无角色且无法由 selfUid/manual_reply 判定」标为 unknown，ingestMessage 直接返回：不进入 buyer/seller 队列，也不写 seen、文本去重或水位，因此后续权威渠道仍可归属；显式 role=system 的真实系统提示仍按原规则吸收。持续未知帧不会抬高未来水位，也不会恢复默认 buyer。
- 无消息项 ID 的旧面板不能再靠一条公共文本放行。v11 只要求最近已知消息中任一条文本出现在 DOM；当 A 的旧面板为 [hello, A 私有问题]、B 的已知消息只有 [hello] 时，单条 hello 会把整个旧面板错认成 B，私有问题进入 B 的 pending 和 reviewHistory 基线。v12 在缺少 `middlePanel_list_<msgId>` 时要求每个将被 DOM 采集的气泡文本都能对应目标买家的已知消息，任一无法证明即 fail closed；存在消息项 ID 时仍逐条校验全部 ID 属于该买家。稳定的三路 uid、currentUserInfo/列表最新消息 ID、卖家 merchantMessage 与正常采集路径保留。
- v12 只改 `desk-v1/src/injections/pdd-web-hook.js` 及本轮 PDD 测试，不扩大其他 vendor/server 逻辑。先补负向用例并在 v11 上实际得到 4 项失败（晚到 buyer、晚到 seller、持续未知水位、无 ID 公共文本），修正后 2 文件 12 项通过；原 6 项正例、取消/批准/逐字/单次点击断言未改。后续复核指出普通对象字典会把继承的 `constructor`/`toString`/`__proto__` 当成已知文本，v12 改用无原型字典并补 3 项负向用例（先红后绿）；真实店铺仍需实店验收，离线夹具不代表实店已通过。

## 2026-11-19：关键词开关运行时匹配注入（1.0.69）

`backend.cjs` 的 `createBackend` 仅新增可选 `resolveKeywordSafety`：ReplyEngine 的既有 `getConfig` 在合并本店 handoff 记录后调用该宿主函数，只允许替换生效的 `handoffKeywords/manualReplyKeywords` 两个数组；未注入时与上游完全一致。本店自定义人工关键词仍优先于全局配置，全局开关关闭时只过滤“继承全局”的店铺；客服接管开关关闭时仅停止卖家侧关键词匹配。ConfigStore 的原始 `safety.handoffKeywords/manualReplyKeywords` 不删改，开关本体由本工程 `reception-keyword-settings.json` 原子保存。相关 `source-files.json` 保留 upstreamGitBlob/upstreamSha256，仅更新实际 sha256 与 localPatch 说明。

本工程 `electron/reception-keyword-settings.ts` 统一严格校验、开关 CAS 和运行时过滤纯函数，`electron/local-runtime.ts` 负责组合及串行保存；界面仅在失焦或开关操作时提交。新增真实引擎配置测试验证开关不改变原始关键词，并保留自定义店铺关键词优先语义。

## 2026-11-17：同一买家随机回复节奏

reply-engine 与 backend.cjs 新增可选 resolveUidIntervalMs：ReplyEngine 保存并转发给每个 StoreWorker，Worker 把 storeId、uid、lastSentAt 与自身随机源交给该函数。抽样、缓存、随保存失效和范围校验全部在本工程 TypeScript，vendor 不保存节奏业务规则；未注入时每次动态读取上游 perUidMinIntervalMs（旧 save-config 改值立即生效）。注入时不再叠加旧 0.5~2s 发送抖动，只保留所选的一套间隔；解析异常时退到 1 秒下限，不回退旧 60 秒。决策文案显示本次实际间隔，pacingIntervalMs(uid) 供本工程消息诊断读取同一值。发送审批、取消、发送前复核、重试与单店分钟上限均未改动；REPLY_PACING 旧保存分支保留但桌面端不再使用。随机模式、范围校验与旧值迁移在 electron/reply-pacing.ts（reply-pacing.json），config.json 的旧固定值原样保留用于审计/回退。source-files.json 保留 upstreamGitBlob/upstreamSha256，仅更新这两个文件的实际 sha256 与 localPatch。

# 2026-11-19：新店引导登录区固定留顶

`electron/platform-host.cjs` 的既有 layoutViews 仅按可信呈现参数 `layout=onboarding-login` 将顶边从72调整到216，为八步条和登录确认预留144逻辑像素；其他布局及隐藏逻辑不变。渲染调用经原 business:present-store 主frame校验和枚举白名单，不接受任意坐标。source-files.json 保留 upstreamGitBlob、此前实际 previousSha256，并更新实际sha256及补丁原因。真实模块的布局回归及242项上游测试通过；不把隔离前端预览当作原生新主进程已生效。
