# billing 模块

职责：充值、订单、算力和账户界面聚合。

主页LoginDialog使用公开AccountBillingDetails（BillingDashboard compact模式）展示按需订单/消耗详情；订单只查orders与刷新额度，消耗只刷新额度，不自动读取套餐/创建订单/发起支付。配置中心的orders/usage面板和账户账单菜单已移除，账户、账本与充值兼容能力保留。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：ShopRechargeView、ShopAccountPanel、OrdersPanel、UsagePanel。

当前业务状态：本机自带 Key 的费用由模型服务商账户管理。托管模式使用实际账号快照显示累计调用额度；套餐和订单通过公开入口 `billingTransportKey` 注入的受限认证 transport 查询。缺少 transport 或商户配置时明确禁用支付，不展示虚构套餐、收款码或入账成功。

2026-11-18 第二轮清理删除无消费者的 `OrdersPanel`、`ShopAccountPanel`、`ShopRechargeView`、`UsagePanel` 四个 demo 工厂；对应真实组件和服务入口不变。

`contracts.ts` 校验服务端套餐/订单/checkout DTO；`services.ts` 定义 BillingTransport 并限制固定端点及 Stripe HTTPS checkout 来源；`use-billing.ts` 处理刷新、幂等checkout及账号切换迟到响应隔离；BillingDashboard 被充值/订单/额度三个页面复用。UI 内不访问网络、Electron 或凭据。服务端实现与准确公共装配要求见 `docs/parallel/billing-handoff.md`。

当前仅实现单次购买调用额度，不是对公转账或自动续订服务；没有按店铺小时消费明细。支付返回不会标记成功，只有服务端签名校验和事务入账才能显示paid。部署、真实商户沙箱及退款/拒付流程仍需独立验收。

2026-11-17 原生扫码渠道客户端接入：`contracts.ts` 增加官方微信/支付宝渠道、试用/付费额度池、划线原价、订单 `closed`/`reconciling` 状态、`qr_code` 与 `expires_at` 字段（均可缺省，旧服务端继续按 stripe 与账号快照展示）。`services.ts` 增加固定端点的单笔查单 `GET /api/client/billing/orders/<id>` 与关单 `POST .../close`，订单号和请求号先按 `[a-zA-Z0-9_-]{1,128}` 核对再拼接；历史 `checkout.stripe.com` 网页支付白名单与 openCheckout 保持不变。`use-billing.ts` 保留套餐/订单/账本各自独立的加载、错误与重试状态，新增收银台：按服务端 channels.ready 选择渠道、3 秒一次查单（最多 15 分钟，可手动重试）、先确认关单再换渠道、从最近订单恢复，切账号/来源/工作区或卸载时停止轮询并丢弃迟到结果。`BillingDashboard.vue` 沿用充值页卡片布局，只在套餐卡片加选择入口，并新增收银台卡片与订单的支付方式/状态/继续支付列；compact 模式（主页登录弹窗）保持只读，不出现收银台、支付入口或操作列。二维码使用 MIT [node-qrcode](https://github.com/soldair/node-qrcode) 1.5.4 在本机把渠道文本转成 data URL（`payment-code.ts` 懒加载），不调用远程二维码服务、不打开二维码内容。托管内部摘要免费与充值渠道无关，客户端不会把摘要请求计费或伪装入账。

2026-11-14 修复：独立充值页复用 `shared/ui/AppWindowBar.vue`，固定返回工作台 `/` 和配置中心 `/shop/manage`，不依赖浏览历史；仅桌面显示原生窗口按钮。套餐、充值订单和账本保留各自错误/加载与重试，404 未部署、401 登录过期、未配置商户、网络及订单冲突不会合成成功空态。切账号/来源/工作区或离开页面会丢弃迟到结果；支付返回只核对账本。共享错误 DTO 位于 `shared/contracts/managed-service-error.ts`，公共 IPC 的解包由平台适配层负责。服务版本、管理员加密沙箱配置及候选部署说明见 `server/BILLING_DEPLOYMENT.md`。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。并行开发的领域结果写入 docs/parallel/billing-handoff.md，公共HANDOFF由统筹更新；仅运行本次修改及直接影响的增量检查。

2026-11-16 充值页卡片布局（1.0.25）：复用现有 Element Plus 按钮、提示和订单表格，仅调整 BillingDashboard 与 ShopRechargeView 的模板/局部样式。居中展示额度、响应式等高套餐卡片及订单区，剩余额度突出，compact 订单/用量保持窄容器布局。金额、调用数、有效期、支付事件、错误和到账核对逻辑保持原样；不新增依赖或支付请求。

## 2026-11-19 支持项目与额度延期

首页“支持我们”跳转 `/shop/recharge`，充值页合并刷新入口，额度明细和已完成充值记录默认收起，待支付/待对账订单自动展开；compact 账户详情继续只读。支持项目获赠套餐所列调用额度，沿用原支付及到账校验，不是另行赠送一份额度。

原生默认套餐新增 `support_100000` 共创支持包：100000 分（¥1000）、100000 次、365 天。客户端仅对此固定套餐与金额展示金色卡片和“专属一对一客服 / 程序开发者一对一对接”，不自动创建客服会话或承诺定制开发交付。旧服务端尚未返回该套餐时不伪造可购买套餐。

新付款入账在同一事务内延长尚未到期的试用池，有效期取原试用到期与入账后付费到期较晚值；试用次数、已用和预留计数不变。试用优先扣减、过期余额不恢复、历史已入账订单不追溯；重复回调不重复延期。接口与数据表结构不变。服务端已按最小生产补丁上线 `2026.11.19-support.1`，实际部署与验证边界见 `server/DEPLOYMENT-20261119-SUPPORT.md`；客户端由统一整合入口交付。

## 扫码收银台交互修正

点击支持套餐后使用居中ElDialog并自动加载首个可用官方渠道的二维码，不再把收银台放在页面底部等待第二次创建。已有未完成订单（含重新进页面读到的订单）优先恢复，不自动关单换套餐；订单列表读取失败时先刷新核实，失败重试沿用原请求号。关闭弹窗继续查单，身份变化关闭并丢弃迟到二维码。compact账户详情仍只读；本次仅客户端交互，不需要服务端再次部署。

自动支付结果查询继续使用既有3秒节奏及防并发锁，但不驱动支持按钮、刷新按钮或收银台的加载动画/提示。创建订单、恢复订单、手动查单和关单保留可见反馈；二维码内容不变时继续复用原图片，不因查单重建。
