# 来源与本地适配

2026-11-16：多模型范围复用固定 New API 渠道、Gin/GORM 和原生 React（AGPL-3.0-or-later）。新增 model_policy.go/test.go，策略支持全部/指定多个，账号模型作为默认偏好；聊天显式模型参与去重摘要。仅迁移此功能，保留主干计费和其他功能，不引入旧工作区支付/摘要业务。导入文件实际 SHA256 已更新，upstreamSha256 保留。

2026-11-14 计费修复：新增自有 `lingtuhost/billing_config.go`、配套测试和原生 `admin-billing.tsx`，复用固定 Stripe Go v81.4.0、GORM 的 `ManagedSetting/lingtu_secret`、`AdminAuth` 和精确请求安全证明。管理员配置只接收沙箱 Key，既有环境变量兼容保留；新增只读版本/能力和官方 SDK 商户账号检查，检查不创建订单或付款。导入的 proof section 白名单仅增加 billing；管理页增加计费入口与翻译，Nginx 参考配置补支付返回页精确转发。所有改动维护在 overlay/部署参考，导入文件保留 upstreamSha256 并更新实际 SHA256；`.upstream` 只由 prepare/构建生成。实际商户沙箱、生产部署和真实支付未验收，详见 BILLING_DEPLOYMENT.md。

2026-11-14 并行整合：新增自有 lingtuteam 和 lingtu/lingtuhost 的 billing 领域，复用原 Gin/GORM、调用次数账本及已有 Stripe Go SDK。routes.go 仅新增团队/计费注册到现有 clientAuth 后，迁移失败中止启动；source-files.json 保留原始来源摘要并更新该文件实际哈希。没有修改固定 New API 版本或许可。原生 SQLite、会话鉴权、团队撤权和签名回调验证与实际商户验收分开记录，见 ../docs/parallel/INTEGRATION.md；新代码不代表支付已开通。

2026-11-14 品牌修订：用户要求对外名称统一为灵兔 AI。覆盖层管理页、设备授权页、相关测试及 translations.json 使用新中文名称/英文 Lingtu AI；patches.json 仅调整原生网页标题与默认 SystemName 显示值。协议、域名、凭据与原项目许可不改动。source-files.json 为这 5 个导入文件保留 upstreamSha256 与实际 sha256；未把生成目录改动冒充维护源码。

- 来源仓库：https://github.com/907609732/LTTLT-AI-Customer-Service
- 分支：codex/managed-admin-real-ui-20261113；PR #21。
- 固定提交：fd45e3832f3cceefefa64f8ff43d05da2cffe5e9。
- 导入范围：原 managed-server 整个目录，以及原 scripts/prepare-managed-server.mjs；不导入其 React 桌面应用或覆盖云朵 Vue 前端。
- 原 README 保存在 README.upstream.md，原项目许可保存在 LICENSE-LTTLT。New API 的固定提交、许可及完整源码由 upstream.lock.json 和 .upstream/LICENSE 保留；发布二进制附带原生许可。
- source-files.json 保存导入文件的 SHA256。准备脚本的唯一适配是把目录定位改为当前 server，使其可独立准备；原始摘要与实际摘要均已登记。
- root 的 check:vendor 同时检查本目录导入文件。原生 Go/React/已有 JS 属于保留来源的导入例外，不用桌面 TypeScript 检查冒充原生测试。
- 本地新增 verify.ts 是运维编排，用 Node.js >=24 的 TypeScript 支持执行，另由 tsconfig.server-tools.json 和根 ESLint 检查；不是服务端业务补丁。

桌面只复用已有 managed-session 协议，自有 TypeScript 控制器负责模式、账号隔离、受控操作及提交诊断。vendor/backend.cjs 仅新增可选 traceId 向 managedChat 的本机 options 转发，不进入请求正文；双哈希记录仍在 vendor/source-files.json。服务端 Go/API 逻辑未因本次导入而修改。

上游部署记录、真实供应商配置、GitHub CI 历史不能当作本机验证结果。当前本机验证及明确未测范围见根 docs/MANAGED_SERVICE.md 与 VALIDATION.md。

2026-11-14 本机启动修订：用户明确要求 HTTP、无需证书。routes.go 的来源检查转入新增 local_http.go，并只为显式回环模式安装 peer/Host/Origin 守卫；新增 local_http_test.go 验证边界。patches.json 在此模式跳过远程 HTTPS CORS，中间件仍拒绝跨来源请求。两处导入文件保留 upstreamSha256 与实际 sha256；start-local.ps1 是新增本机运维入口，不是上游文件。远程 HTTPS 逻辑与生产部署入口保持原有约束。

## 1.0.13 视觉图片兼容补丁（2026-11-16）

overlay/lingtuhost/chat.go、vision.go 和 vision_test.go 允许受限 PNG 分块输入：规范 base64、完整 PNG 解码、单图 8 MiB、1400×1400、总正文 16 MiB、非图片结构 128 KiB。实际获准通道的模型字段用于判断 qwen3-vl-plus 视觉能力，支持动态连接别名；不修改账号授权和调用次数账本。原导入文件保留原始哈希与本地补丁说明，实际哈希同步清单。原生 server:verify 已通过；用户单独授权的现有服务更新和实店模型验收状态见 ../docs/HANDOFF.md。

实店大图验收另发现 routes.go 原全局 1 MiB MaxBytesReader 仍先行拒绝请求。现提取自有 client_body.go：仅精确 POST /api/client/chat/completions 允许 16 MiB，其余 client 接口保持 1 MiB；原鉴权、频率、PNG 和文字校验均保留。client_body_test.go 已先复现旧限制，再验证该精确路径及其他方法/路径。服务端原生验证再次通过，补丁在用户原部署授权范围更新，回执位于私有服务器 backups/20261116-ocr-vision-bodyfix/deployment-result.json，旧二进制和数据库/配置备份保留，切换前后账本指纹一致。

## 1.0.18 成本估算

新增自有 model_costs.go 与测试，复用固定上游现有 shopspring/decimal，按配置人民币单价计算实际返回 Token 的管理成本估算。ModelConnection 和 managedUsage 仅增量字段；原配置 proof / audit / revision、调用和钱包账本保持。旧调用回算与新调用价格快照明确区分。导入文件修改保留原始哈希与补丁说明，详细契约见 docs/MANAGED_SERVICE.md。

2026-11-16：在最新 main 原生成本、支付配置和视觉能力上整合人民币微元费用、缓存计价、不可回推的历史快照与旧接口兼容，复用已有 Gin/GORM/React、decimal 和固定 New API。微元算法参考现有 New API/LiteLLM 计费口径，无新增运行依赖。增加临时 Vault 测试入口、官方原生数据库工具编排与 MySQL 支付会话幂等回读；不合入其他分支的摘要、原生支付或桌面改动。来源原摘要保留，维护摘要更新。
## 2026-11-17 生产原生支付/额度/摘要与微元成本合并

以生产来源归档 server/artifacts/production-source.tar.gz（base 209f7b77d27fea6ad4aea89c0674d954a4e44649）为准，与当前 f476016 成本覆盖层做三方合并。生产侧原样保留 lingtu/quota.go、lingtu/trial.go、lingtu/limits.go、lingtuhost/billing_native*.go、lingtuhost/summary.go、lingtuhost/routes.go、lingtuhost/billing*.go 及其测试；当前侧保留微元成本、缓存价、价格快照和费用后台。lingtuhost/chat.go、chat_test.go 逐段融合，未用旧版页面覆盖成本 UI，也未把生产摘要/额度替换为旧实现。patches.json 同时保留生产 go.mod/go.sum 的 GoPay 依赖和当前详细 token 用量补丁。

服务版本更新为 2026.11.17-cost.1，能力名在生产全集上增加 	oken-cny-cost-estimates。摘要走同一 prepareChat 路径，因此沿用价格快照并保存 cost_micros/cost_status，但仍通过 SettleAuxiliary 免扣调用次数；主聊天保留生产原生额度扣费。未修改商户配置字段、密钥序列化、账本唯一键、回调验签或支付 SDK。来源原始 SHA256 保留，最终维护文件哈希在 source-files.json 更新。

## 2026-11-17 cost.2 历史回算与日月报表

服务版本更新为 2026.11.17-cost.2，未改变计费协议和支付能力。新增只读历史当前价格估算字段与报表合计；仅当记录缺少快照和持久化状态、记录渠道与模型精确匹配当前 `CostRateModel` 且用量与单价可用时估算，缓存明细缺失时按普通输入价并显式标注。原 `cost_micros`、`cost_status`、数据库行和 `cache_usage_known` 不变，已有快照优先且不重复计数。日接口保持默认 7/30 天语义，新增 `period=month` 近 12 个自然月、独立 `today`/`this_month` 和严格参数校验；管理网页新增日/月金额卡、分周期金额表与费用图，保留模型筛选和 Token 图。支付、额度、摘要免扣、导入来源 SHA256 及原始上游哈希保持不变。
