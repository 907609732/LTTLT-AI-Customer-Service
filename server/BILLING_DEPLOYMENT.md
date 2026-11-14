# 计费服务部署与核对

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
