# 充值与计费修复交接（2026-11-14）

任务 C 的本地领域实现、直接影响检查与候选服务包已完成。主进程/平台适配的公共 IPC 装配由统筹维护。随后用户明确授权仅升级大陆现有服务；已于 2026-11-14 21:14 完成实际部署及客户端只读验收，计费路由的大陆 404 已修复。没有 git stage/commit/push、商户开通、订单创建、付款或正式收费。

## 装配与文件边界

- `ShopRechargeView` 自带共享 `AppWindowBar`，固定返回 `/` 和 `/shop/manage`，不依赖浏览历史。浏览器隐藏原生按钮；桌面经现有 `shared/platform/desktop` 调用最小化、最大化/还原和关闭。没有修改公共 MainLayout、router、main、preload 或 local-runtime。
- `billingTransportKey` / `BillingTransport` 的固定路径保持不变：`GET /api/client/billing`、`GET/POST /api/client/billing/orders`。请求正文仅含 `{plan_id,request_id}`。公共主进程仍先剥离 `/api/client`，再复用 `managed.serviceRequest('/billing'|'/billing/orders', ...)`；不向渲染层暴露 Bearer、账号 ID 或价格决定权。
- 新 `shared/contracts/managed-service-error.ts` 导出 `ManagedServiceResponse`、`ManagedServiceFailure`、闭集错误码及对应 Zod schema。响应为 `{ok:true,data}` 或 `{ok:false,error:{code,status,message,retryable}}`。
- 新 `electron/managed-service-error.ts` 导出 `toManagedServiceFailure(cause)`，只保留受限 HTTP 状态和闭集错误码，未知归 `request_failed`；消息来自本地固定文本，不序列化 cause、IPC 前缀、响应原文、请求头或凭据。统筹在业务 IPC 捕获并返回 envelope，再由平台层解包。
- vendor 仅修改 `managed-session.cjs`：HTTP 错误保留安全 `code/status`；代理纯文本/HTML 404 标识未部署，401 走既有会话失效，已知商户未配置 503 不再将账号误置 offline。请求白名单、大小、超时、加密、epoch 与模型不确定结果保护保留。原始/实际双哈希和来源说明已更新。

## 客户端行为

套餐、充值订单和账本有各自错误、加载状态和重试；套餐失败不会跳过另外两项。失败不展示“暂无已发布套餐”的成功空态；没有商户配置时隐藏可购买套餐。订单明确称软件充值订单。

已区分 404 未部署/代理缺路由、401 登录过期、商户未配置、无已发布套餐、网络失败及订单冲突。过期/停用/离线会话保留对应的恢复提示。工作区、来源、账号变化或离开页面会丢弃迟到结果；同一页面失败重试保留 checkout 请求 ID，未知结果不创建新的自动付款。

外部 checkout 只接受精确 HTTPS `checkout.stripe.com`，主进程须继续复核当前工作区及来源。返回页面只提示回客户端刷新账本；不显示充值成功或假称入账。账本同步失败保留“上次同步、尚未核实本次入账”的状态。

## 服务端入口

`RegisterBilling(router, authenticated, db, portal)` 签名不变，现有 routes.go 注册无需增加其他公共装配点。入口内部迁移 billing 两表，并注册：

| 路径                                      | 约束                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/lingtu/service`                 | 公开、无账号/凭据的版本能力探针；版本 `2026.11.14-billing.2`，协议 2 |
| `GET /api/client/billing`                 | 原受限会话；返回 ready/reason/plans 和 service                       |
| `GET/POST /api/client/billing/orders`     | 同一认证；当前账号订单与服务端价格，幂等创建/取回 checkout           |
| `GET/POST /api/lingtu/admin/billing`      | AdminAuth；写入另需交互式登录、精确请求安全证明、修订号检查          |
| `POST /api/lingtu/admin/billing/check`    | AdminAuth 和限流；官方 SDK 只读账号检查，不创建订单或付款            |
| `POST /api/lingtu/billing/stripe/webhook` | 官方 SDK 原文验签、付款模式/金额/session 核对及事务幂等入账          |
| `GET /lingtu/billing/payment-return`      | 静态核对提示页，不声明付款或到账                                     |

管理网页新增「充值与计费」，组件为 `admin-billing.tsx`，沿用现有 API、Query、表单、单次安全证明与中英翻译。proof section 白名单只增加 billing，保留精确 body 绑定和不可重放语义。

管理员只保存沙箱 `sk_test_` 配置和自行填写的整数分套餐，没有预设商业售价。保存到 `ManagedSetting` 的加密 `billing_stripe` 行，保留审计、修订冲突和空密钥保留/显式清除。只在行不存在时兼容原环境变量；清除不会偷偷回退到环境凭据。新配置无需重启即生效；禁用购买但保留凭据时，已有有效签名付款仍可入账。

只读商户检查明确返回 `webhook:not_verified`、`payment:not_tested`；不返回密钥、不记录上游原文、不创建订单。沿用 Stripe Go v81.4.0（MIT）、Gin、GORM 和原 TrialStore；没有第二套钱包或试用账本语义变更。详细配置、回滚、Nginx 返回路径和实际商户条件见 `server/BILLING_DEPLOYMENT.md`。

## 实际验证

仅运行本任务与直接影响范围，未运行全量 Release/check/server:verify：

- 桌面模块：`vitest tests/billing.test.ts tests/managed-service-error.test.ts`，17 项通过。覆盖首次路由固定返回、浏览器隐藏与桌面适配调用、401 恢复状态、套餐失败仍读订单/账本、失败非空态、账号切换/卸载迟到结果、整数金额/URL、受限正文和结构化错误不泄漏。
- vendor 原生计费会话 3 项通过；`managed-controller.test.ts` 6 项通过。先观察 404/503/409 状态丢失及未配置误标 offline 的失败，再实现。
- `vue-tsc -p artifacts/billing-repair/tsconfig.json` 与计费改动范围 ESLint 通过，严格选项继承根配置；未关闭 strict。
- 原生 Go 17 项通过，命令过滤为 `TestBilling|TestTrialGrantIsNotResetByLoginOrRestart|TestLingtuConnectionProofSupportsExactManagedSectionAndBody`，包含真实回环 HTTP、受限签名会话、匿名 401/停用 403、加密存储、修订冲突、精确 body/重放拒绝、SDK checkout/商户查询、伪签名与篡改拒绝、8 次并发仅一次入账、过期额度不复活、事务回滚及原调用 Reserve/Settle。报告 `server/artifacts/billing-go-tests.jsonl`。
- 管理网页 20 项通过（admin-page 与 admin-billing）；原生 typecheck 检查 1430 文件通过，变更范围 oxlint 通过，翻译生成检查 2 项通过。先观察缺商户表单/检查入口失败，再实现。生成原生路由后检查，未把初次尚未生成的路由类型错误当作业务失败。
- 原生网页构建、Linux amd64 和 Windows amd64 服务编译通过。冻结 Bun 1.4.4 安装；只针对构建子进程清除已失效的 127.0.0.1 代理以下载锁定 Go 依赖，没有降低版本或改全局代理。
- 实际 Windows Go 进程在全新临时 SQLite、随机主密钥/会话密钥、动态数字回环端口启动，明确移除继承 SQL/Redis 配置。版本探针 200；`/me`、`/billing`、`/billing/orders`、管理员 billing 均 401；支付返回页 200 且只提示核对。进程已停止，成功测试临时资料已移除。报告 `server/artifacts/billing-process-http.json`。
- vendor/server 来源清单完整性检查（80/92 文件）和 diff 空白检查通过；Go 文件已 gofmt。

## 候选产物与剩余验收

`server/artifacts/billing-repair-release/` 和 `server/artifacts/billing-repair-20261114.tar.gz` 包含 Linux 服务、同次网页、许可、说明和摘要清单，不包含数据库或凭据。Linux 服务 SHA256：`0c628fd4a71c47e6af38ac76b6c0510126c6dd5390a866e5d58788f398bc7053`；包 SHA256：`91d054526f2f1b676a9a0eed3efba8f9f7f0fc6465eb2ecf68e0f1c2157fc442`。该包已通过已有 SSH 通道上传大陆现有服务器，未公开发布。

大陆生产实际 `current` 为 `/opt/lingtu-kefu/releases/20261114T130358Z-billing.2`，旧 `/opt/lingtu-kefu/releases/223e923b73fb-web` 保留。服务器内受限备份目录 `/opt/lingtu-kefu/backups/20261114T130358Z-billing.2` 包含在线快照、停服后的最终一致数据库、原主密钥/环境/unit/Nginx，目录 700、数据库/凭据 600；没有下载业务数据或密钥。

切换前的 Linux 实机隔离进程使用全新临时 SQLite/随机 keys、明确移除生产 SQL/Redis，上限 256 MiB、峰值约 83 MB，通过后才停止旧服务、最终备份和原子切换。原调用账本逐行指纹一致、生产环境/主密钥未变，商户配置仍不存在。仅为账号域名增加支付返回页精确代理，nginx-t 后 reload；其他 Nginx 配置摘要不变，没有更改 DNS/TLS、其他站点或重启整机。成功后未触发回滚，旧 release 和备份保持可用。

回环、服务器 HTTPS/SNI 和用户电脑 NoProxy 外网复核：版本探针 200=`2026.11.14-billing.2`/协议 2，匿名 me/billing/orders/admin billing 均 401，API 健康、管理页及支付返回核对页均 200。服务 active/running，自动重启 0。

统筹的原已登录客户端通过真实受限 preload 查询套餐/充值订单成功：`ready:false`、`payment_not_configured`、套餐 0、订单 0；真实充值页账本同步、版本与协议展示正常，商户未配置提示明确、购买按钮 0，没有未部署提示或 Vue 错误。没有创建订单或付款。本机脱敏证据在 `server/artifacts/billing-production-deployment-20261114.json`，完整部署/回滚位置见 `server/BILLING_DEPLOYMENT.md`。

停止在当前无商户、无支付的安全状态。真实商户沙箱凭据、回调投递、明确授权的测试付款/到账、MySQL/PostgreSQL、退款拒付/发票及其他支付方式仍未验收；不能把路由修复和无配置只读验收称为真实支付已接通。
