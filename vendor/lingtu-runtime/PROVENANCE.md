# 上游来源与维护边界

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

本机模拟店铺：electron/backend.cjs 的 createBackend 新增可选 extraPlatforms，只把注入项合并进 allPlatforms（按 /^[a-z0-9][a-z0-9-]{0,39}$/ 过滤），用于 capabilities.platforms 快照与 add-store 的平台校验；未注入时 allPlatforms 与上游 platforms 完全一致，拼多多/抖店的默认清单、accessModeFor 与 createAdapter 表均未改动。云朵在 electron/local-runtime.ts 注入唯一一项 sim-local（本机模拟店铺），其适配器、门店管理器与模拟顾客页全部位于本工程 TypeScript（electron/sim-*.ts）与渲染层模块 src/modules/simulation/。

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
