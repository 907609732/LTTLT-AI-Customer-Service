# 计费服务部署与核对

## 共创支持包永久额度候选

`2026.11.19-permanent.1` 只对新共创支持包订单启用永久条款。既有订单和试用、普通付费池由原规则结算。上线前验证新增订单列和永久额度表的迁移，检查订单快照和消费来源，再以隔离渠道回执验证一次入账及跨年余量。已有永久额度入账后，回退方案必须保留永久额度、已扣次数和待结算请求的解释能力。回退前须先停止新增订单及付费请求，并核对新增账目。旧服务不能结算 `permanent` 来源的请求。

## 2026-11-19 学习协议候选（本机准备，未部署）

本次只读核对生产服务仍为 `2026.11.19-support.1`，当前运行二进制不包含学习专用校验分支，且没有 `context_policy` 配置记录。新的学习请求曾按普通回复校验而失败；不能通过免费摘要、清除暂停或换提示代替协议修复。

本机候选标识为 `2026.11.19-learning.1`，保留原计费协议与能力，增加 `managed-learning-policy`；它包含此前已合入但未部署的上下文策略和托管视觉实现。上线前须确认本机候选、隔离测试、实际二进制/网页哈希和回滚计划，然后取得用户的生产升级及学习策略启用授权。策略默认关闭；不得为兼容旧服务伪造开启、降低普通回复校验、自动重试旧任务或把未知用量算零。不会因本机准备自动修改生产账号、余额、模型、密钥、DNS 或 TLS。具体候选和授权状态以本次修复交接为准，下方记录为历史。

## 2026-11-17 成本与生产支付/额度/摘要合并（未部署）

本轮以共同来源提交 `209f7b77d27fea6ad4aea89c0674d954a4e44649` 做三方合并：当前分支的微元成本（缓存价、价格快照、未知状态、后台费用页）与生产 `2026.11.16-wechat.1` 的微信/支付宝 Native 支付、试用/付费独立额度、免费摘要逐段融合。候选版本为 `2026.11.17-cost.1`，计费协议仍为 `2`；能力名保留生产全部项（`billing-orders`、`stripe-signed-credit`、`encrypted-billing-settings`、`billing-merchant-check`、`native-signed-credit`、`billing-order-reconciliation`、`trial-paid-quota`、`summary-no-call-charge`），并新增 `token-cny-cost-estimates`。未改动商户配置和密钥字段、Stripe/原生回调验签、账本唯一键与扣次幂等；未新增支付 SDK，继续使用固定 GoPay v1.5.123 和 Stripe Go v81.4.0。

Native 支付沿用现有环境入口（密钥只放服务器受限环境文件，不写数据库明文、不进仓库）：

- `LINGTU_BILLING_NOTIFY_ORIGIN`：HTTPS 回调源，服务据此拼出 `/api/lingtu/billing/{alipay,wechat}/webhook`。
- 微信：`LINGTU_BILLING_WECHAT_APP_ID`、`_MERCHANT_ID`、`_PRIVATE_KEY`、`_PUBLIC_KEY`、`_API_V3_KEY`、`_CERT_SERIAL`、`_PUBLIC_KEY_ID`。
- 支付宝：`LINGTU_BILLING_ALIPAY_APP_ID`、`_MERCHANT_ID`、`_PRIVATE_KEY`、`_PUBLIC_KEY`。

未配置的渠道在套餐/渠道响应中保持 `ready:false` 和 `payment_not_configured`，不会创建订单。回调只接受签名校验通过的商户、AppID、订单号、金额与币种；重复通知按订单和渠道交易号幂等入账。微信 Native 商户订单号保持 16 字节十六进制（32 字符）以符合官方长度限制。真实商户验证仍须由 Codex 上线时单独执行，本机只做模拟测试，没有连接生产数据库、真实回调或付款。

摘要路由 `POST /api/client/chat/summaries` 复用主聊天的鉴权、限流、额度预留和模型分发；摘要调用免扣付费/试用次数，但按同一价格快照记录实际 token 用量和微元成本，重放不会重复记录。主聊天图片 16 MiB 正文限制和其他 client 路由 1 MiB 限制保持原样。

本文件下方 2026-11-14 部署记录描述的是上一版生产状态，保留作历史；当前候选未部署、未提交，验收命令和结果见本轮交接报告及 `SERVICE_TESTS.md`。

## 2026-11-16 微信 Native 历史部署记录（旧工作区保留）

以下为当时工作区的部署记录，本次仅保留文档，没有重新连接生产或重新核验付款。后续成本报表版本及最新部署以 DEPLOYMENT-20261117-COST.md 为准；下文“尚未验收”只描述当时检查范围。

后续单笔真实验收：2026-11-16 19:32，用户明确授权创建 ¥9.9/1000次体验包订单并自行扫码。真实已登录客户端读取订单paid、付费余额0→1000，生产只读账本确认同单仅1条1000次入账，原试用余额保持。未人工补写额度、重复创建或退款。该成功闭环已通过，以下“真实付款前”与订单0记录是部署切换当时的边界；完整桌面收银台、退款和其他失败场景仍未由本次单笔付款证明。

用户明确授权备份后部署，真实付款测试前另行告知。北京时间 19:21 完成切换，健康恢复耗时约 2.79 秒。服务版本 `2026.11.16-wechat.1`；新 release 为 `/opt/lingtu-kefu/releases/20261116-wechat-native.1`，保留原 `20261116-cny-1.0.18`。

- 先核对实际线上版本，再以其来源提交 `209f7b77d27fea6ad4aea89c0674d954a4e44649` 在隔离工作区合入支付。没有将旧工作区整个构建覆盖生产；线上原网页及人民币/模型策略保留。
- 备份目录 `/opt/lingtu-kefu/backups/20261116-wechat-native`：在线数据库快照、停机后最终一致快照 `managed-final-before-cutover.db`、原环境文件、主密钥、systemd、Nginx 均保留。SQLite 完整性通过。账号、渠道、加密设置、模型、试用与历史请求、用量、订单/入账的旧字段逐行指纹保持一致。
- 单独部署 root:600 的 `shared/wechat-payment.env`，新增仅引用该文件的 systemd drop-in；原 `service.env`、主密钥、unit 主文件和 Nginx 摘要不变。无 DNS/TLS/其他站点改动。支付宝没有配置或开放。
- 候选在断外网的生产副本上验证启动、迁移及鉴权。正式服务器 GoPay 官方随机不存在订单查单及响应签名验证通过，无订单创建、收费或入账。
- 公网 `/api/lingtu/service` 返回新版本；微信回调空 JSON POST 返回 400 `invalid_webhook`（原先404）；匿名套餐返回401，账号后台网页200，HTTPS验证通过。服务 active/running，自动重启0；上线后订单和充值入账均0。
- 本机两包 Go 测试 `./lingtu ./lingtuhost` 在最后修复后通过（4.283/92.216秒），生成检查2项及Linux构建通过。独立审查发现的 Stripe 停用绕过已先失败复现再修复；32位微信订单号也已回归验证。[微信官方 Native 文档](https://pay.wechatpay.cn/doc/v3/merchant/4012791877) 是订单号长度依据。
- 服务 SHA256 `bcab61fdcb06d4ad19eec5cf128931ed70ec0a15e300075d8c7a24e714549bb9`，部署包 SHA256 `ba327ba6a3f80fc0f716de1c71253e9a2ab75e5457971d921739b66a46ed0486`。沿用 GoPay v1.5.123，Apache-2.0；release 包含许可及对应覆盖层、精确补丁和构建脚本的 `SOURCE.tar.gz`，不含凭据/业务数据。

恢复脚本位于备份目录 `rollback-wechat.py`，已做语法检查，未为演练重复切换生产。只有排障确需回滚时才以 root 执行；恢复旧程序并停用新增支付环境，保留最新账本，不把旧库覆盖新付款/用量。新增付费额度在旧程序下不保证可消费，需修复版恢复后继续使用。

本机详细证据：`server/artifacts/wechat-production-deployment.json`、`wechat-deployment-ledger.md`、`wechat-review.md`。真实下单二维码、扫码付款、真实异步通知与查单到账闭环、当前桌面付款界面尚未验收；不能把400拒绝伪造通知表述为收到真实支付成功通知。下一步经用户确认后用固定 ¥9.9 体验包验收，不修改真实套餐为1分钱测试。

本文件对应服务版本 `2026.11.14-billing.2`、计费协议 `2`。2026-11-14 用户明确授权仅升级大陆现有客服服务；已于北京时间 21:14 完成实际部署、备份和路由验证。商户仍未配置，没有创建订单、付款或启用正式收款。

## 2026-11-14 大陆部署记录

通过已有 SSH 通道连接后，先核对运行中的 systemd、Nginx、current、数据库与密钥路径，再部署。实际布局如下，不是直接套用示例：

| 项目 | 实际结果 |
| --- | --- |
| 服务 | `lingtu-kefu`，回环 `127.0.0.1:3211`，systemd 用户/组 `lingtu-kefu` |
| 当前 release | `/opt/lingtu-kefu/releases/20261114T130358Z-billing.2` |
| 保留的原 release | `/opt/lingtu-kefu/releases/223e923b73fb-web` |
| 生产数据库 | `/opt/lingtu-kefu/shared/managed.db`，SQLite WAL，完整性检查通过 |
| 服务器内备份 | `/opt/lingtu-kefu/backups/20261114T130358Z-billing.2` |
| 最终一致数据库备份 | 上述目录的 `managed-final-before-cutover.db`；停旧服务后、切换前创建 |
| 原代理配置 | `/etc/nginx/conf.d/lingtu-kefu.conf`，原内容备份为 `lingtu-kefu.nginx.conf` |

备份同时保留原环境文件、主密钥、systemd unit 和在线数据库快照；目录权限 700、数据库/凭据备份权限 600，仅留服务器，没有下载业务数据或密钥。候选包先限速上传，服务器复核包 SHA256：`91d054526f2f1b676a9a0eed3efba8f9f7f0fc6465eb2ecf68e0f1c2157fc442`，随后校验清单 1851 个文件。

切换前在服务器真实启动 Linux 候选，使用全新临时 SQLite、随机测试密钥，并显式移除生产 SQL/Redis 等配置；内存上限 256 MiB，观测峰值约 83 MB。通过后停止旧服务、保存最终一致备份、原子切换 current 并启动新服务，切换至健康约 1 秒。原调用账本的受保护字段逐行指纹一致；生产环境文件和主密钥未变，商户环境变量及 `billing_stripe` 配置仍不存在。

只对账号域名增加 `/lingtu/billing/payment-return` 的精确代理。Nginx 修改前后语法检查通过后 reload；其他 Nginx 配置摘要不变，没有修改 DNS、TLS 或其他站点，也没有重启整机。

回环、服务器本机 HTTPS/SNI 以及用户电脑 `NoProxy` 外网请求均验证：

- `/api/lingtu/service` 为 200，版本 `2026.11.14-billing.2`、协议 2。
- 匿名 `/api/client/me`、`/api/client/billing`、`/api/client/billing/orders`、`/api/lingtu/admin/billing` 均为 401，计费 404 已在该大陆服务修复，鉴权保留。
- API 健康与账号管理页为 200；账号域名支付返回页为 200，内容只提示“刷新账本、不代表支付成功”。
- 统筹通过原已登录客户端的真实受限 preload 读取套餐与充值订单成功：`ready:false`、`payment_not_configured`、套餐 0、充值订单 0。真实充值界面账本同步、服务版本/协议展示正常；显示商户未配置提示、购买按钮 0，没有未部署提示或 Vue 错误。
- 后续只读观察服务为 active/running，自动重启次数 0；商户、订单创建和付款均未执行。

服务器记录为备份目录内 `deployment-result.json`；本机脱敏证据为 `server/artifacts/billing-production-deployment-20261114.json`。本次成功未触发回滚，保留旧 release 和备份，不为演练再次切换生产。真实商户沙箱、签名回调投递、付款及正式收费仍未验收。

## 已有能力与配置入口

- `GET /api/lingtu/service` 是无凭据的版本/能力探针，包含 `version`、`billing_protocol` 和闭集能力名，不返回账号或商户资料。
- 套餐、充值订单继续使用相同的受限设备会话：`GET /api/client/billing`、`GET /api/client/billing/orders`、`POST /api/client/billing/orders`。匿名请求应为 401，路由不存在才是 404。
- 登录原管理网页 `/lingtu/admin` →「充值与计费」。`GET /api/lingtu/admin/billing` 仅返回配置来源、修订号、模式、凭据是否存在及套餐。`POST` 同路径要求 `AdminAuth`、交互式登录和绑定本次完整请求 SHA256 的单次安全证明；修订冲突返回 409，不覆盖其他管理员修改。
- 管理网页只接收 `sk_test_` 沙箱凭据。没有预设售价，金额为人民币整数分。凭据和套餐共同保存在 `lingtu_settings` 的 `billing_stripe` 行，复用 `lingtu_secret` 加密；空密钥保留，显式清除会禁用新付款，且不会重新落回环境变量。
- 仅当没有数据库配置行时，兼容原 `LINGTU_BILLING_STRIPE_SECRET_KEY`、`LINGTU_BILLING_STRIPE_WEBHOOK_SECRET` 和 `LINGTU_BILLING_PLANS` 环境变量。保留既有正式模式兼容不代表本轮开通正式收款。未配置、停用或无有效套餐时不会向客户端下发可购买套餐。
- `POST /api/lingtu/admin/billing/check` 受 `AdminAuth` 和限流保护，只使用官方 Stripe Go v81.4.0 查询当前测试账号，并读取计费/调用账本的表可用性。不创建订单、不付款、不入账。成功也明确返回 `webhook: not_verified`、`payment: not_tested`；保存凭据同样不代表商户已验收。

Stripe webhook 为 `/api/lingtu/billing/stripe/webhook`，需要原始请求正文和 `Stripe-Signature`。固定 SDK 的事件 API 版本为 `2025-02-24.acacia`；不忽略签名时间窗口和 API 版本。只有验签后的已付款 payment session 经金额、币种、session 与订单核对后，才会在原调用账本事务中入账一次。禁用新购买但保留凭据时，已有待核对订单仍可合法结算；清除签名密钥前须先核对未结订单。

## 产物与可回滚要求

候选包在忽略目录 `server/artifacts/billing-repair-release/`，包含 Linux amd64 服务、同次构建网页、许可、部署说明和带 SHA256 的清单。归档为 `server/artifacts/billing-repair-20261114.tar.gz`。该固定包已上传到上述大陆服务器并完成部署；不是桌面 Release，没有公开发布，也不含数据库、环境文件、主密钥或凭据。包内说明保留构建时状态，以本文实际部署记录为准。

后续升级仍应先读取实际 systemd、Nginx、数据库及 release/current 布局，不能仅据本次记录覆盖正在运行的站点。本次已确认服务名 `lingtu-kefu`、根目录 `/opt/lingtu-kefu`。

1. 记录当前服务版本、二进制/网页摘要和 `current` 指向；备份数据库、主密钥与受限配置。保留原 release，不覆盖旧目录。
2. 校验候选清单，在新的独立 release 中运行检查，再切换 `current`。本次已按该步骤执行；没有调用 `bootstrap-private.py` 或初始化生产。
3. API 域名必须把 `/api/client/billing*`、`/api/lingtu/service`、`/api/lingtu/admin/billing*` 及 webhook 转给同一服务，不能误交给 SPA 或旧进程。保留管理员鉴权、来源限制和 HTTPS。
4. 账号域名 `/lingtu/billing/payment-return` 必须转给服务端静态核对提示页。已在 `deploy/lingtu-kefu.nginx.conf` 增加精确 location；真实部署前比较当前配置并执行 `nginx -t`。该页仅提示回客户端刷新，不宣称已付款或已入账。
5. 切换失败时将 `current` 指回记录的旧 release，并重启对应服务；不要覆盖其他站点或改 DNS。本轮不涉及 DNS/TLS 变更。上线后若已发生付款或用量，不能用旧数据库覆盖新账本；需保留新账本并人工对账。

本机准备的包较大，不在 3 Mbps 业务服务器建立安装包/视频镜像；后续若需传输或发布，应使用用户已授权的外部制品渠道。私有管理网页与账号接口不得复制为公开静态站。

## 部署前后只读路由核对

先对实际回环监听地址检查，再对反向代理域名检查。无 Bearer 运行下列示例，不要把令牌放到终端历史或报告中：

```sh
curl --fail --silent http://127.0.0.1:3211/api/lingtu/service
curl --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:3211/api/client/billing
curl --silent --output /dev/null --write-out '%{http_code}\n' http://127.0.0.1:3211/api/client/billing/orders
curl --fail --silent https://api-kefu.lttlt.top/api/lingtu/service
curl --silent --output /dev/null --write-out '%{http_code}\n' https://api-kefu.lttlt.top/api/client/billing
curl --silent --output /dev/null --write-out '%{http_code}\n' https://api-kefu.lttlt.top/api/client/billing/orders
curl --fail --silent https://account-kefu.lttlt.top/lingtu/billing/payment-return
```

预期版本为 `2026.11.14-billing.2`、协议 2；三个受限读取入口 `/me`、`/billing`、`/billing/orders` 在匿名情况下均应 401。回环正确而域名 404 指向代理差异；两边都 404 或版本不符指向旧服务/端口。200 HTML 也不是正确的 JSON 能力响应。管理员接口匿名应为 401；不要通过关闭鉴权来测试配置。

登录后的桌面验收须使用真正的受限设备会话。本次已通过原登录客户端检查无配置状态、充值订单和账本同步；真实商户沙箱仍需管理员填写可用测试凭据、配置签名回调、完成一笔用户明确授权的测试付款，并核对事件、订单与调用额度只入账一次。当前服务路由已修复不等于商户付款已接通。

## 复用来源

沿用现有 Gin、GORM 加密设置/事务账本和 [Stripe Go v81.4.0](https://github.com/stripe/stripe-go/tree/v81.4.0)（MIT），未引入第二套钱包或支付库。官方 [测试环境说明](https://docs.stripe.com/testing) 和 [密钥说明](https://docs.stripe.com/keys) 用于区分沙箱与正式模式。New API 来源与 AGPL 许可保留，源码覆盖层以 `overlay` 和精确补丁维护；`.upstream` 仅为生成缓存。
