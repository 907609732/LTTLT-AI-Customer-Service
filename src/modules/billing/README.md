# billing 模块

职责：充值、订单、算力和账户界面聚合。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：ShopRechargeView、ShopAccountPanel、OrdersPanel、UsagePanel。

当前业务状态：本机自带 Key 的费用由模型服务商账户管理。托管模式使用实际账号快照显示累计调用额度；套餐和订单通过公开入口 `billingTransportKey` 注入的受限认证 transport 查询。缺少 transport 或商户配置时明确禁用支付，不展示虚构套餐、收款码或入账成功。

`contracts.ts` 校验服务端套餐/订单/checkout DTO；`services.ts` 定义 BillingTransport 并限制固定端点及 Stripe HTTPS checkout 来源；`use-billing.ts` 处理刷新、幂等checkout及账号切换迟到响应隔离；BillingDashboard 被充值/订单/额度三个页面复用。UI 内不访问网络、Electron 或凭据。服务端实现与准确公共装配要求见 `docs/parallel/billing-handoff.md`。

当前仅实现单次购买调用额度，不是微信/支付宝/对公或自动续订服务；没有按店铺小时消费明细。支付返回不会标记成功，只有服务端签名校验和事务入账才能显示paid。部署、真实商户沙箱及退款/拒付流程仍需独立验收。

2026-11-14 修复：独立充值页复用 `shared/ui/AppWindowBar.vue`，固定返回工作台 `/` 和配置中心 `/shop/manage`，不依赖浏览历史；仅桌面显示原生窗口按钮。套餐、充值订单和账本保留各自错误/加载与重试，404 未部署、401 登录过期、未配置商户、网络及订单冲突不会合成成功空态。切账号/来源/工作区或离开页面会丢弃迟到结果；支付返回只核对账本。共享错误 DTO 位于 `shared/contracts/managed-service-error.ts`，公共 IPC 的解包由平台适配层负责。服务版本、管理员加密沙箱配置及候选部署说明见 `server/BILLING_DEPLOYMENT.md`。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。并行开发的领域结果写入 docs/parallel/billing-handoff.md，公共HANDOFF由统筹更新；仅运行本次修改及直接影响的增量检查。
