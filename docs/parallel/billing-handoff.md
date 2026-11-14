# 套餐、充值和调用账本交接（2026-11-14）

状态：领域内部实现与核心增量验证完成；统筹已通知完成公共路由、受限IPC和Vue provider接入，并解除“AI余额耗尽阻止充值”的公共认证耦合。本窗口没有修改公共 router/patches.json/主进程/共享契约/vendor/HANDOFF，也没有提交、推送、部署、商户开通或真实收费。

## 可直接装配的导出

- `server/overlay/lingtuhost/billing.go`: `RegisterBilling(router *gin.Engine, authenticated *gin.RouterGroup, db *gorm.DB, portal string) error`。在 `TrialStore.Migrate()` / `h.migrateChat()` 成功后、已有 `authenticated := group.Group("", h.clientAuth)` 建立后调用 `if err := RegisterBilling(router, authenticated, model.DB, portal); err != nil { return err }`。函数内部迁移独立 billing 两表、注册三个受限账号路由和 Stripe webhook、返回静态提示页，无后台 goroutine 和清理要求。不改现有 trial 请求结算路径。
- `src/modules/billing/index.ts`: `billingTransportKey`、`BillingTransport`、`createBillingClient`、catalog/orders/checkout 的 Zod Schema 和 DTO 类型。App 装配 `app.provide(billingTransportKey, transport)`。组件仅通过模块服务操作，不接触网络、Electron 和令牌。
- 当前 transport 契约：`request(method: 'GET'|'POST', path: '/api/client/billing'|'/api/client/billing/orders', body?: {plan_id:string;request_id:string}): Promise<unknown>`，以及 `openCheckout(url:string): Promise<void>`。主进程适配时把 `/api/client` 前缀去掉，再调用统筹新增的 `managed.serviceRequest('/billing'|'/billing/orders', {method,body,signal})`。也可以统一调整本模块 transport 参数顺序；核心限制为两个固定 endpoint、GET/POST 与固定 body，绝不允许渲染层传入认证头/账号ID/金额。
- `openCheckout` 必须主进程再次校验精确 `https://checkout.stripe.com`、无账号密码和自定义端口，仅在当前账号/工作区仍一致时打开默认浏览器。渲染层已有相同校验；主进程不可仅信任渲染层结果。

## HTTP 契约

1. `GET /api/client/billing` → `{ready:boolean,reason:string,plans:[{id,name,currency:'cny',amount:integer分,calls:integer,valid_days:integer}]}`。
2. `GET /api/client/billing/orders` → `{orders:[{id,plan:{同上},state:'pending'|'paid',created_at:Unix秒,paid_at:Unix秒或0}]}`。服务端从认证身份限制当前账号最近100条，不接受客户端 user_id。
3. `POST /api/client/billing/orders` body `{plan_id,request_id}` → `{order:{同上},checkout_url:string}`。金额、币种、调用次数和期限只由服务端配置确定；支付已入账的重试返回空URL。`request_id` 必须跨网络失败重试保持一致；换账号时清除。错误结构与原API一致 `{error:code}`，包含 `payment_not_configured/invalid_request/invalid_plan/billing_conflict/checkout_unavailable/billing_unavailable`。
4. `POST /api/lingtu/billing/stripe/webhook`：服务商签名回调，不需要用户会话。必须在反向代理转发原始body和`Stripe-Signature`，不能要求客户端登录。仅验签后的 paid payment session 可以入账，不接受浏览器返回或客户端 outcome。测试/正式模式必须与密钥一致。严格匹配固定SDK的API版本`2025-02-24.acacia`，不忽略版本或时间窗口；商户webhook须配置此版本。
5. `GET /lingtu/billing/payment-return`：静态提示返回客户端刷新，不声称付款成功。portal 域名需将此路径转发到同一服务端，若独立网页托管则统筹补同语义页面，不能重定向到不存在路由。

## 配置与业务语义

新增服务端环境变量（全部缺省关闭支付）：

- `LINGTU_BILLING_STRIPE_SECRET_KEY`：服务端 Stripe key，不写日志/源码/渲染层。支持 sk*test*/sk*live* 格式；本任务未填写或调用真实商户。
- `LINGTU_BILLING_STRIPE_WEBHOOK_SECRET`：whsec\_ 签名密钥。
- `LINGTU_BILLING_PLANS`：严格JSON数组，最多20档，禁止重复ID和未知字段。例如仅作为隔离测试配置：`[{"id":"starter","name":"测试套餐","currency":"cny","amount":1000,"calls":100,"valid_days":30}]`。这不是已批准商业定价，不默认发布套餐。

复用固定 New API 的 `stripe-go/v81 v81.4.0`（MIT）、GORM和现有 TrialStore 事务/调用次数账本，无新依赖。New API固定来源与AGPL许可保持原样。候选研究：[New API](https://github.com/QuantumNous/new-api)、[官方 Stripe Go SDK](https://github.com/stripe/stripe-go)。上游原生钱包按Token额度，本客户端托管按调用次数，故不能把原生钱包充值直接伪称本产品调用次数；采用独立订单/不可变credit凭证，原事务内增加实际TrialGrant，再复用Reserve/Settle。

- 金额全部整数分；已存订单快照不随套餐变价改变；同账号request_id不可更换套餐参数。
- 同一订单只能入账一次，重复事件/不同事件对同一已付session不重复增加额度；金额、币种、session必须精确匹配。SQLite并发使用既有持久化写门与事务重试；没有进程内互斥假装跨实例幂等。
- 支付失败或结果未知保留pending，用户不能手动标记paid。重复checkout使用Stripe幂等键；已持久化session通过SDK取回，避免幂等键过期后再创一个支付链接。
- 充值增加既有调用池；有效期为max(当前到期,入账时刻+套餐天数)，不叠加年限；已过期未用额度不恢复，used/reserved保留以兼容在途结算。使用共享调用池而非逐订单独立到期，界面明确说明。
- 仍受现有托管模型、并发/速率/每日安全策略限制，不自动开AI，不改变逐条发送确认。摘要和回复可能各算一次。
- 暂不提供退款/拒付自动冲正、发票、微信/支付宝、对公转账、订阅自动续费和按店铺小时扣费明细；不得称全部商业上线验收完成。上线前需补退款/拒付流程与真实商户沙箱验收。

## 文件和验证

新增：server/overlay/{lingtu,lingtuhost}/billing{,\_test}.go；src/modules/billing/{contracts,services,use-billing}.ts；components/BillingDashboard.vue；tests/billing.test.ts。修改：billing/index.ts、README及ShopRechargeView/OrdersPanel/UsagePanel/ShopAccountPanel四个组件。ShopAccountPanel现按既有viewKey实际装配订单与额度页，避免navigation仍指向账号聚合入口时新组件悬空；账号说明按实际托管状态显示。未改其他领域文件。

已完成验证：先跑新增Go测试缺实现编译失败、客户端测试缺service失败，然后实现；账本测试2项通过、host配置/paid-session规则2项通过、transport契约2项通过。后续完整本范围增量结果追加在此文件末尾。

环境：实际源码是当前E盘client；Node24.18、Go1.27.3与现有依赖可用，未系统安装新环境。prepare初次被旧127.0.0.1 Git代理阻断，使用单次`git -c http.proxy=`克隆固定上游后完成prepare，不改全局代理。

下一验收：统筹已接公共注册、受限IPC及Vue provider（已只读核对实际main.ts与routes.go），集中prepare后以隔离账号/数据库、Stripe官方测试签名payload核对整链路和界面；当前生产/真实商户/真实收费均未验收。

## 最终增量证据

- Go：`go test ./lingtu ./lingtuhost -run 'TestBilling|TestTrialGrantIsNotResetByLoginOrRestart' -count=1 -parallel=1 -p=1 -v`，7项新增billing测试+1项既有试用不重置回归全部通过（lingtu0.582s，lingtuhost1.549s）。范围包含并发8次重复回调只入账一次、金额不匹配拒绝、充值后实际Reserve/Settle、过期不复活旧余额、凭证冲突整笔回滚、官方SDK向本机httptest的价格/幂等键与重试GET、伪签名/篡改签名拒绝和合法签名重复入账去重。SDK请求仅发向本机fixture，不是Stripe沙箱付款或实账成功。
- 客户端：`npx vitest run tests/billing.test.ts --maxWorkers=1 --minWorkers=1`，6项通过：Zod/金额/URL边界，checkout仅传套餐与请求ID，账号切换丢弃迟到响应，实际Vue DOM本机模式不显示虚构套餐/支付成功，既有账号聚合入口真实装配订单/额度组件，用户离开页面后不打开迟到checkout。
- `npx eslint src/modules/billing tests/billing.test.ts`通过；`npx vue-tsc --noEmit -p artifacts/billing/tsconfig.json`通过。专用忽略产物中的tsconfig继承项目配置，仅包含billing文件、该测试、src/env.d.ts；没有通过关闭strict消除错误。最初项目范围vue-tsc遇到其他并行领域TeamPanel/TeamWorkOrderPanel的隐式any，因此改用精确范围验证，没有抢改他人文件。
- Go文件gofmt完成；只对billing相关文件Prettier，无全目录格式化。
- 补充复用核对：Grep MCP读取Stripe官方`webhook/client.go`和测试（MIT），Context7确认签名/默认时间窗口/API版本要求；当前Context7只有更新SDK版本的索引，因此最终接口兼容以本机锁定v81.4.0源码和实际Go编译/fixture验证为准。skills.sh候选主要面向Vercel/Node或第三方平台，不引入不匹配工作流；使用现有Go官方SDK与现有事务能力。
- 按统筹最新要求，停止再次prepare公共.upstream或重启桌面；最后Go验证基于本任务overlay复制到生成目录，后续公共prepare与整合检查由统筹集中完成。

尚未验收：真实商户配置/Stripe沙箱与正式事件、MySQL/PostgreSQL矩阵、最终整合客户端截图与桌面跨IPC闭环、退款拒付/发票和国内支付方式。当前服务仅支持每账号调用池，不实现团队共享额度。没有全量Release构建或生产修改。
