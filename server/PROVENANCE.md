# 来源与本地适配

2026-11-17 托管上下文策略管理页：新增自有 overlay/web/src/features/lingtu/admin-context-policy.tsx 与 admin-context-policy.test.tsx，复用原生 Card/Input/Textarea/Switch/Button、现有 secure-save 回调和翻译目录；管理页只增加托管模型上下文导航、上下文策略安全保存与 409 类型化冲突，保留 model_connection 及其他 section 行为。保存请求精确为 section=context_policy、顶层预期 revision、嵌套完整策略且不含 revision；隐藏提示词仅在本组件显示，不写日志，本地校验 UTF-8 8192 字节、256..4096 检索预算、binding 首/template 尾、学习来源、1..20 调用、512..4096 输出及固定审核/视频/语音字段。自动查询失效或 409 不覆盖脏草稿，只有管理员点击刷新才重新载入；刷新失败时保留草稿并显示错误。导入 admin-page.tsx 实际 SHA256 为 `3cb846b3f45a82b19b0c5aad31c23aac1d8a83c29b4319309aa80d04d766ad11`，admin-page.test.tsx 为 `7deef96eb97a88e7ea1cd0ed20bf481bd93f7e624709ab05be206d826ff11b44`，translations.json 为 `bf52125f7e18cd98d0ea633565429cc5d5db7bb4ab539d5785d277c28aba61a2`；原 upstreamSha256 保留，本地补丁说明已更新。新增文件不写入 source-files.json（该清单只登记导入文件），其 SHA256 分别为 admin-context-policy.tsx `a963a8af5a21ca7809b87b24be3a9913796019f320ba5c2bad6f106d716f68ff`、admin-context-policy.test.tsx `fa844df9bb4b10a97961ad32b21129b74141ba82f273bc8dbfe8063ecb0466d3`。生成目录 server/.upstream 仅由 prepare/构建刷新，不视为维护源码。

2026-11-17 托管上下文策略管理员接口：overlay/lingtuhost/admin.go 在原 AdminAuth 下让 GET /api/lingtu/admin/config 返回完整 context_policy（含 revision 与管理员编辑用 system_prompt），POST 增加 section=context_policy，顶层只接受 section/revision/context_policy，嵌套候选由 Task 1 的 DecodeContextPolicyInput 严格解码；沿用原生交互会话、精确请求哈希安全证明、全局配置锁和 ManagedAudit。成功返回 saved=true 与新策略，旧 revision 返回 409 revision_conflict 和最新 revision，非法字段/值 400，数据库失败 503，提示词不写日志。overlay/service/lingtu_verification.go 的证明 section 白名单仅增加 context_policy，未改变其它 section。新增自有 admin_context_policy_test.go SHA256 为 `f3c7750efb854645c5df32e478a63a85b32ab8d2edea96fe828fd26986cb4234`；admin.go 实际 SHA256 为 `f0813e821e34d06f0d2c871e230c82f78d3dcf21d82ed7d966b429c02b6de482`；lingtu_verification.go 实际 SHA256 为 `d3b7682b71fcfcb2fb8e9527ba9462127107b8eeeaf862362ceb13788e1241ca`；lingtu_verification_test.go 实际 SHA256 为 `f3b32f8ae889af38e98b3cab2423f442220cf368035ca824e7608f0da745e02c`。导入文件保留原 upstreamSha256，仅更新实际摘要与本地补丁说明。新增测试不写入 source-files.json（该清单只登记导入文件），其摘要记录于本段。

2026-11-17 托管上下文策略持久化：新增自有 overlay/lingtu/context_policy.go 与 context_policy_test.go，定义全局策略、严格校验、加密读取、基于 lingtu_settings 修订号的原子 CAS 保存和安全客户端投影；视觉学习允许开关仅表示策略允许，默认开启但学习任务默认关闭，真正调用仍需模型能力校验。context_policy_test.go 为 SHA256 `3069ff971be351bd976eaada4301d14aa9757be86996ac1d5d1ede674a1edeb4`，context_policy.go 为 SHA256 `9fee2ff5daaaa53ec491123b2bb36a6051eab62bc1f26c31bc07004f8986895c`。导入文件 overlay/lingtu/settings.go 仅为 ManagedSetting 增加 revision 列并保留旧数据默认值，实际 SHA256 更新为 `14632be1462930580c1f7308953a27d8ffcf67bfeea5e843b50d34b20a8f39ae`，原 upstreamSha256 `abe3a0d51749548fc1643503a89a0be8968d4ab09223dbcd2d9daac60c54d48d` 不变。新增文件不冒充上游导入；隐藏提示词与策略原文仍由既有 lingtu_secret 加密，客户端只取得安全投影。

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
