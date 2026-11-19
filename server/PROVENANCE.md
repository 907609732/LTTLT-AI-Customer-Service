# 来源与本地适配

## 2026-11-19 共创支持包永久额度

候选服务 `2026.11.19-permanent.1` 增加 `permanent-support-quota`，计费协议仍为 2。共创支持包新订单快照增加 `permanent` 标识，金额、调用次数与渠道核对规则不变。账本自动增加 `plan_permanent` 列和 `lingtu_permanent_grants` 表，已存在订单默认按原条款结算。永久额度在既有入账及预占事务中独立计数，试用、有期限付费、永久额度按顺序使用。限期付费和试用仍使用各自原规则。试用额度继续沿用原延期规则，永久套餐购买后按一年延期，不延成永久。旧桌面仍能解析 valid_days 和额度总数，新桌面以 permanent 标识显示永久期限。实际文件哈希见 `source-files.json`，固定来源与许可不变。此处记录本机候选，线上服务须按授权另行部署。

## 2026-11-19 学习协议候选标识（未部署）

实际六商品计划含单品 25/37 次调用，为避免开启策略后仍被固定上界 20 阻挡，Go 策略、原生管理表单及桌面安全投影的可配置上界同步扩为 40；新配置的默认仍为 20、学习仍默认关闭。管理员显式保存更高预算才会改变该限制，保存预算不会自动开启学习，客户端仍须按实际商品合计执行服务端预算，禁止静默丢资料。补充 37/40 接受、41 拒绝及默认关闭回归；没有修改任何生产策略或真实费用。

为区分缺少学习协议的线上 `2026.11.19-support.1` 与当前已有学习策略/视觉源码的候选，将 `overlay/lingtuhost/billing_config.go` 服务标识改为 `2026.11.19-learning.1`，保留计费协议 2 和全部既有能力，增加 `managed-learning-policy` 能力声明；没有改变支付、余额、密钥或扣次逻辑。同步实际服务信息回归与 `source-files.json` 的本地摘要：`7c599278952536eba36c4689c03a7a0acd05bf3d94ebbe0a9c66c9b472259831`，保留固定来源与许可。该标识代表协议支持，不代表学习策略已开启或生产已更新；本批部署及真实模型调用须用户单独授权。

## 2026-11-19 托管视觉路由与图片验证（本机实现，未部署）

来源仍为固定提交 `fd45e3832f3cceefefa64f8ff43d05da2cffe5e9`，New API 固定提交 `48a6c87f9e7757fdc58e5be9bcb4f8281ad0dfd0`，未新增依赖、SDK、通用路由或公开端点。变更交付说明见 `VISION_MODEL.md`，执行日志和未解决项见根 `artifacts/size-vision-20261119/managed-vision-implementation-report.md`。

- `overlay/lingtu/settings.go`：`TrialPolicy` 新增可选 `vision_model`，缺字段保持旧 Qwen 路由。
- `overlay/lingtu/model_connection.go`：新增独立图片验证状态/哈希/时间字段，继续复用加密渠道凭证，不复制 Key。
- `overlay/lingtuhost/model_policy.go`、`chat.go`、`routes.go`：显式视觉路由必须已授权、ready、文字连接测试成功且图片验证有效；图片请求在 `ReserveWithLimits` 前失败，显式客户端模型必须等于管理员视觉路由，旧空字段的显式视觉别名/文字图拒绝语义保留；能力投影按实际路由覆盖 `vision/max_images`。
- `overlay/lingtuhost/admin.go`、`admin_models.go`：管理员 `action=verify_vision` 绑定连接、revision、config_hash；固定合成图探针只更新图片验证字段并做 CAS，不创建 `managedUsage`、不扣额度、不改内部渠道状态；普通文字测试不写入图片验证。
- `overlay/controller/lingtu_channel.go`：新增受限图片探针，复用固定上游 relay 测试入口。`patches.json` 仅增加 `controller/channel-test.go` 的注入图文消息和读取测试响应体三个精确锚点，未修改 `.upstream` 源文件。
- 前端 `admin-page.tsx`、`admin-models.tsx` 增加授权/ready/已验证候选筛选、独立“验证图片”动作和状态；`admin-page.test.tsx` 增加定向 UI 回归。

实际 SHA256：`overlay/controller/lingtu_channel.go` `5397dc929131bf0b00e3bbb6e5bd62879796267c39c4dcac51ecc14e75b85d66`；`overlay/lingtu/model_connection.go` `9edb839161f6e299688b736477c307a86eeb6a88015a32fc69b2dd7b11a7a58a`；`overlay/lingtu/settings.go` `1a9d0ee0aef60cf54a612841756b8a47b4fa7ff492e9f91bd2d076899588df2c`；`overlay/lingtuhost/admin.go` `e9bf80625a4b957680c419e3e7f2df44d08183705aecee407f4ac30757af92d4`；`overlay/lingtuhost/admin_models.go` `4498cfa668c326bf26b0bb8604421a8fbcd215b0756e434201f5ddcb9addd156`；`overlay/lingtuhost/chat.go` `58b1583752aa095c80617404eae5c2aa63f0c840ac9db4ba9d4c2dc76ceed080`；`overlay/lingtuhost/routes.go` `1727cf2623a7137e1e31f589462ba2e632480bbb417c50e67425621f5f8a66eb`；`overlay/web/src/features/lingtu/admin-models.tsx` `31bf8302c59848001e90904deb33a0ca7d33652426579b6a34d7d3d63b1b9868`；`admin-page.tsx` `f847d9182362d56837a428c9599b553a93f40c52c09c71da9026d39bff17b6f2`；`admin-page.test.tsx` `a6e349ce9483b31026bc8147df1c95ade90e2cc1aa0dc1b2e4a875106c706f20`；`patches.json` `794786664af5aa476171b53d6c3b82f57c53bf416d6be9ba122c33dde5592aea`；`translations.json` `6d809a0cda893be1586248e003d268032cc4c52d0b35d2c18a0762414398cfcf`。自有新增 `overlay/controller/lingtu_channel_test.go` `29ba491274aa58e1bb18a3aa46b28aa35d846d018a3bb55c54e746982c3ee0e8`、`overlay/lingtuhost/managed_vision_test.go` `b93d62569c32236dee2d297b255187d1696b1230e73745b8319d7f01297b3d7d`、`VISION_MODEL.md` `06bb7f2a9810c7eb62df6a3792f6fe72aa2f0d14331c6f64db4c1c4f155155b8`。新增测试不写入 `source-files.json`（该清单只登记导入文件）；`source-files.json` 已按上述导入文件实际字节更新摘要。未部署生产、未改真实账号/额度/密钥、未调用付费模型。

验证范围：`go test ./lingtuhost -run TestLingtu`、仅图片探针与相关上下文策略子集、`go test ./lingtu` 受影响用例、原生网页 `admin-page.test.tsx`、typecheck、oxlint、oxfmt check、build 和 `preparation.test.mjs`。未运行全量上游 controller 回归、全库 Go、MySQL/PostgreSQL 矩阵或真实供应商验收；这些不得据本条声称已通过。

修复轮1（review 基于 `cc19bc7`）：恢复旧 `vision_model` 空字段的显式视觉别名兼容和显式文字+图片 400 语义，不靠修改旧用例夹具；显式新路由同时要求文字连接成功与独立图片验证，四端共用判定；账号能力按实际路由覆盖 `vision/max_images`；legacy 同配置 no-op 保存保留图片验证；图片验证改用仅图片字段的条件 `UPDATE` 并检查 `RowsAffected`，旧 revision/禁用/渠道 hash 变化返回 409 `vision_verification_stale`。本轮证据与未解决项见 `artifacts/size-vision-20261119/managed-vision-fix1-report.md`。

修复轮2（review 基于 `f8f9220`）：legacy section 的真实文字探针 now 会写入本次 `TestStatus/TestedHash/TestedAt/TestTime`，no-op sync 只保留图片验证；图片验证条件 `UPDATE` 原子递增 `revision`，避免 MySQL `clientFoundRows=false` 把同秒相同结果误判 stale，管理员采用 fresh revision。证据见 `managed-vision-fix2-report.md`。

修复轮3（review 基于 `505a28c`）：图片探针失败已落库并递增 revision 时，前端仅在连接相同、config hash/enabled 相同且 fresh revision 恰为原 revision+1 时接收失败状态与新 revision，保留草稿并允许直接重试；真正 409 stale/外部修改仍保留冲突阻断。证据见 `managed-vision-fix3-report.md`。

修复轮4（review 基于 `c9ddac9`）：移除依赖 props/ref 时序的失败行接收 effect；父级把失败持久化的 `model_connections` 作为 typed `SaveFailure` 返回，子级在同一失败响应内按 captured id/provider/hash/enabled/revision+1/failed 校验后直接更新草稿，refetch 延迟或同引用也不会卡住重试。真实 409 stale/外部 revision 仍保留冲突。证据见 `managed-vision-fix4-report.md`。

MySQL 隔离修复（main `5e09021` CI databases 失败）：`managed_vision_test.go` 的 `countUsage` 原以全库绝对 0 判断，MySQL 共享 fixture 中既有 `lingtu_usage` 被误判为本次图片验证新增。现测试先插入真实 usage/TrialRequest 基线，保存验证前计数，验证后断言计数不变且基线内容完整；不删除/清空共享表，新增记录会由 delta 明确失败。证据见 `mysql-isolation-fix-report.md`。

## 2026-11-18 设备授权注册回跳整合（候选，待复核）

来源：`a28750d`（`codex/device-registration-redirect-20261117`，base `377193d`）。本轮以真实合并父整合到 `07a2ac6` 之上，只重放 redirect 功能补丁：`patches.json` 为 `web/src/features/auth/sign-up/components/sign-up-form.tsx` 增加 5 个精确锚点（`AuthFormProps`、`redirectTo`、`redirectToLogin(redirectTo)`、`handleLoginResult(..., redirectTo)`、`OAuthProviders redirectTo`），为 `web/src/features/auth/sign-in/index.tsx` 增加 `search={{ redirect }}`，并新增 `web/src/features/auth/sign-up/index.tsx`、`web/src/routes/(auth)/sign-up.tsx`、`web/src/features/auth/hooks/use-auth-redirect.ts` 三个补丁键（可选 `redirect` 搜索参数，已登录用户经既有 `sanitizeAuthRedirect` 决定目标）。未新增依赖、公开端点、重定向白名单或 Go 业务改动；外部地址仍回退 `/dashboard`。main 既有成本、支付、上下文策略与限流补丁全部保留。

来源清单：`source-files.json` 现登记本次 4 个测试与 `patches.json` 的实际 SHA256（此前“新增测试不进入该清单”的说明按本轮整合要求更新）。`patches.json` `2cce598645bdcf4d5f27fc81cb0a0f12c5426c3bccf3788a5e5483477a56c6ab`；`admin-login-hint.test.tsx` `ac1ddfd82a3528916b03ccfb9e9ff9f9cca8f852211f5212e6a1ce287770265f`；`auth-redirect-navigation.test.ts` `cc8404b04dc113d8955088ede6baf9e7c71cc37ce44be74cee459a85e8e54d6c`；`redirect.test.tsx` `d2ede817fe8e86f72538de6df2903a6749b8c073b5a55e712dd5889418a2fb24`；`register-redirect.test.tsx` `98822ddb53621ac7eeb1cec3ab46a3bb258c35474d03ce6d1903697f418e8d80`。固定上游 `upstreamSha256`、`upstreamPath` 与其他条目哈希不变。

验证范围：本阶段只执行 `git diff --check`、`npm run check:vendor` 与改动自有文档/package 的格式与解析检查；4 个 auth 测试的定向执行、`prepare`、网页 typecheck/lint/build 与真实浏览器注册回跳验收均未在本阶段执行，须在 Codex 复核后另派，不得据本条目声称服务端 auth 已通过。

2026-11-18 复核补正（P2）：`scripts/verify.ts` 的 `Native frontend tests` 步骤原先只运行 `src/features/lingtu` 与 `src/features/auth/api.test.ts`，没有执行本次三份新增 auth suite。现只在该既有 test 参数追加 3 份精确路径（`hooks/__tests__/auth-redirect-navigation.test.ts`、`sign-up/__tests__/redirect.test.tsx`、`sign-up/components/__tests__/register-redirect.test.tsx`），并在既有 lint 参数追加 `sign-up/index.tsx`、`hooks/use-auth-redirect.ts`、`routes/(auth)/sign-up.tsx`；未扩大到全 auth，未改 Go/DB/deploy 步骤或 GitHub YAML。补测：注册路由 `beforeLoad` 覆盖已登录 + 内部设备目标与外部地址回退 `/dashboard`，`SignUpForm` 覆盖 `OAuthProviders.redirectTo` 与微信 `handleLoginResult(res.data, redirectTo)`；未删除既有断言、未改生产逻辑、未引入依赖。更新后实际 SHA256：`redirect.test.tsx` `3dd29e4778a01b337c8a4dcc3ed1fa780cca9f2dbde7c24f077c8968f3adabc6`，`register-redirect.test.tsx` `7bdf3c21fee4819d4b5e72bc8feb7bd599b86dda339283ccc4fd5e7ddcb8826d`；`auth-redirect-navigation.test.ts` 未改，哈希保持 `cc8404b04dc113d8955088ede6baf9e7c71cc37ce44be74cee459a85e8e54d6c`。

2026-11-17 托管文字/图片分流（本机实现，未部署）：`overlay/lingtu/settings.go` 仅调整出厂 `DefaultTrialPolicy`（100 次、selected、DeepSeek + Qwen3-VL、默认 DeepSeek），并新增旧默认基底解码：有保存行时按旧值（20 次/7 天/无 scope/nil allowed）解码，避免旧 JSON 缺 scope 被扩大授权、`all` 省略 allowed 被填入默认列表而非法；无行才使用新默认。`overlay/lingtuhost/model_policy.go` 新增图片模型选择、出厂双模型策略的文字固定（DeepSeek 不可用时文字/摘要 fail-closed）与“上一版已允许但当前未配置”模型的保留校验。`overlay/lingtuhost/chat.go` 在客户端未指定 model 且含图片时自动改选允许范围内就绪视觉模型，显式选择保持原语义。`overlay/lingtuhost/routes.go` 的 `/me` 能力按视觉路由投影，`model` 仍为文字默认模型。导入文件实际 SHA256：settings.go `11b180ae75cc1cad233cab071852473bec3c43520678f5c9a6e5291f10fc67d3`、chat.go `be2655f64fc74128fd0f74dadd32284f5604e13ed099fc61da230e2e7cc6080c`、routes.go `9b198f6a4c21f6bfbe366105304e0eed26cba26d94b69f4416fd8c5d0cfe0e45`；原 upstreamSha256 均保留，source-files.json 已同步这三项及 vision_test.go `cfd724af6f119da54a5bec00a282e450f00be9e5964dc7ece7e3586e0219ca62`、identity_test.go `da43c16a27d7bca7fb8a3ec4d4fa718ad0d4f84c06fc6a7ccfd6effa0d66908b`、admin_model_default_test.go `8f1a9fdc615c1632653df3c7cf4d92d2d17173beba4cfc8eedd47d93ffbadd3d`、admin_connections_review_test.go `c73ac32cc6524b9af6e235c62c730a88e51ad0a874f18b302a150b7967764e81` 的实际摘要。own 新增 `overlay/lingtu/default_policy_test.go` SHA256 `fe9b9148965f753c5879b9269afb777785ca9c94ec40fd5e03d7c305df1e0e91`，以及 Codex 新增 `overlay/lingtuhost/text_vision_acceptance_test.go` SHA256 `9c6d151578ae7296949811948ab1ffb76caa490b47fe76c918599d7429ae7688`，均在 source-files.json 声明为自有测试（localPatch，无 upstreamSha256）。自有 `overlay/lingtuhost/model_policy_test.go` `f1e01f32e95283e5f9b7398da5d9b246fadb06f747e1f9e0995110c8e896a99d` 与 `client_context_policy_test.go` `a7e3c32ac4944ed587a36c1713aa556a3deecbfa96df00c8d0c4d0c3978fddb8` 沿用“新增测试不写入清单”的既有约定，摘要记录于此。后台试用设置说明与警告在 `overlay/web/src/features/lingtu/admin-page.tsx`（当前 SHA256 `653e321ed7a3dfe200482d6dfe0e010d9323538e755212984595ea52c6c12d3f`）、其测试 `ff30ea1378721ddf81a0b93106de3f8f17eb76f7c7c395ae22a4c1cd00964827` 与 `translations.json` `fd50c68da75e92631d52f1a3b68b53353930472292677e54c96fe4ee021d7ba6`；这三项由 Codex 接手最终 UI 修正后刷新清单摘要，本轮未在 source-files.json 更新其哈希。固定 New API 源码、patches.json 与 vendor 未改动；未部署生产、未修改真实账号数据库、未调用付费模型。

2026-11-17 验证兼容修正：固定上游 `lingtu/billing_checkout_retry_test.go` 已定义 `TestBillingCheckoutAttachmentRetriesAreIdempotent`；本地自有 `overlay/lingtu/billing_test.go` 的跨 Stripe/微信覆盖改名为 `TestBillingCheckoutAttachmentRetriesAreIdempotentAcrossChannels`，只改测试标识，保留两个用例与固定上游源码。`overlay/lingtu/billing.go` 的迁移在没有旧收据时跳过无需执行的试用额度来源回填，使全新仅计费数据库可独立初始化；存在旧收据时仍执行原回填并要求试用额度表。固定上游源码不变。

2026-11-17 托管上下文策略管理页：新增自有 overlay/web/src/features/lingtu/admin-context-policy.tsx 与 admin-context-policy.test.tsx，复用原生 Card/Input/Textarea/Switch/Button、现有 secure-save 回调和翻译目录；管理页只增加托管模型上下文导航、上下文策略安全保存与 409 类型化冲突，保留 model_connection 及其他 section 行为。保存请求精确为 section=context_policy、顶层预期 revision、嵌套完整策略且不含 revision；隐藏提示词仅在本组件显示，不写日志，本地校验 UTF-8 8192 字节、256..4096 检索预算、binding 首/template 尾、学习来源、1..20 调用、512..4096 输出及固定审核/视频/语音字段。自动查询失效或 409 不覆盖脏草稿，只有管理员点击刷新才重新载入；刷新失败时保留草稿并显示错误。导入 admin-page.tsx 实际 SHA256 为 `3cb846b3f45a82b19b0c5aad31c23aac1d8a83c29b4319309aa80d04d766ad11`，admin-page.test.tsx 为 `7deef96eb97a88e7ea1cd0ed20bf481bd93f7e624709ab05be206d826ff11b44`，translations.json 为 `ce0fec3391b6a82b0d921dadf4f72c0114793cf567165afe6179fdaa377be0f3`；原 upstreamSha256 保留，本地补丁说明已更新。新增文件不写入 source-files.json（该清单只登记导入文件），其 SHA256 分别为 admin-context-policy.tsx `e18ae113cad19cf4093fb5e68e84a4f247581c92d36a663247e54d84e9d1ebb9`、admin-context-policy.test.tsx `50e252704dc234a4f4fed96508a5c46e0d05869d7992f7b1dc641fe127d17f65`。生成目录 server/.upstream 仅由 prepare/构建刷新，不视为维护源码。

2026-11-17 服务端模型请求执行上下文策略：overlay/lingtuhost/chat.go 在 prepareChat 中读取单次 ManagedContextPolicy 快照，严格解析可选 purpose（reply/learning）、非负整数 policy_version 与 learning_source（pdd_detail_text/pdd_detail_image），三者显式参与去重摘要，旧请求省略时保持原摘要和回复行为。显式版本不等于当前 revision 时在 ReserveWithLimits 前返回 409 policy_version_stale；learning 还要求当前版本、learning.enabled、允许来源、已启用账号及获准通道真实上游模型能力，图片另需策略 vision_enabled，且图片 parts 必须与声明的文字/图片来源一致。回复启用 runtime_context 时把隐藏 system prompt 仅置于上游请求首位，客户端响应和错误不返回该文本，若模型完整回显或复制较长片段则按敏感内容清洗拒绝；客户端自报 max_tokens 被忽略，回复沿用 trial MaxTokens，学习使用策略 MaxOutputTokens。显式请求及已启用隐藏接待规则的旧请求用既有 tokenkit 按实际上游模型估算文字输入（不含 base64 图片），超过 16384 token 在预留前拒绝；未启用规则的旧请求保留原上限。managedUsage 增量 purpose 列由现有 AutoMigrate 迁移，额度、结算、成本、不确定结果与模型准入不变。策略行损坏时全部请求返回 503，避免绕过已保存的接待规则。新增自有 chat_context_policy_test.go 覆盖隐藏提示仅上游、DebugEnabled 日志替换、learning 关闭/旧版本/错误来源/视觉禁用/模型不支持/客户端输出预算、请求 ID 重放与 purpose/version 冲突、16K 预留前拒绝、旧调用不缩小上限、base64 不按文字计数、成功学习使用大于 512 的服务端输出并记录 purpose 且账本不重复扣减。chat.go 实际 SHA256 为 `5ba3a18df6d3f603d4f89ea6feabe6764ba03182eda7d5c7ae6b21e444479d53`，model_policy.go 为 `fb3f2eb2e3a77229b18f69304d3c85e8d259e1c38b6f7c77c45440bf996f095c`，chat_context_policy_test.go 为 `1480708be95c51bfb4c75e86096f16d328c9e8770eeb321dc1d0835a4e30c4b0`。导入文件保留原 upstreamSha256 `dfabbd7d7f4caa486443c3cda593221c3e9f15a1bf4dae9806f6d54b0bc2a650`，仅更新实际摘要与补丁说明；model_policy.go 和新增测试不写入 source-files.json。固定 provider 的日志替换仍在 patches.json 的 logger/logger.go 中，未修改生成的上游文件。

2026-11-17 客户端上下文策略安全投影：overlay/lingtuhost/routes.go 在原有 clientAuth 保护的 GET /api/client/config 上仅追加顶层 policy_version（等于当前策略 revision）、runtime_context 与 learning，值全部来自 Task 1 的 ManagedContextPolicy.ClientProjection()；保留原 default_model/models/max_tokens 含义、账号和模型授权顺序，不新增公开管理端点，不序列化完整策略、隐藏提示词、供应商路由、凭据、内部模型或成本。无设置行时沿用 DefaultContextPolicy（revision 0），损坏密文或读取失败返回 503 configuration_unavailable，不静默回退默认值。新增自有 client_context_policy_test.go，覆盖真实受限会话下的修订号/投影、原始 JSON 字段白名单与敏感字段缺席、未鉴权 401、损坏/不可读设置 503，以及旧字段和默认策略兼容；routes.go 实际 SHA256 为 `b83c3555b0359c5196ea05bcbdc46342aa141e4c1fd5405323963587a3ad9727`，client_context_policy_test.go 为 SHA256 `95a554dc8204aa7a9b59f77812dbe64253cc6e9dfc5ae326033009b27908d650`。导入文件保留原 upstreamSha256 `06864f9097cc5e2c7010927b6f5ba3d3bba95e0099ff771abbaaebc73932d5c4`，仅更新实际摘要与本地补丁说明；新增测试不写入 source-files.json。

2026-11-17 托管上下文策略管理员接口：overlay/lingtuhost/admin.go 在原 AdminAuth 下让 GET /api/lingtu/admin/config 返回完整 context_policy（含 revision 与管理员编辑用 system_prompt），POST 增加 section=context_policy，顶层只接受 section/revision/context_policy，嵌套候选由 Task 1 的 DecodeContextPolicyInput 严格解码；沿用原生交互会话、精确请求哈希安全证明、全局配置锁和 ManagedAudit。成功返回 saved=true 与新策略，旧 revision 返回 409 revision_conflict 和最新 revision，非法字段/值 400，数据库失败 503，提示词不写日志。overlay/service/lingtu_verification.go 的证明 section 白名单仅增加 context_policy，未改变其它 section。新增自有 admin_context_policy_test.go SHA256 为 `f3c7750efb854645c5df32e478a63a85b32ab8d2edea96fe828fd26986cb4234`；admin.go 实际 SHA256 为 `f0813e821e34d06f0d2c871e230c82f78d3dcf21d82ed7d966b429c02b6de482`；lingtu_verification.go 实际 SHA256 为 `d3b7682b71fcfcb2fb8e9527ba9462127107b8eeeaf862362ceb13788e1241ca`；lingtu_verification_test.go 实际 SHA256 为 `f3b32f8ae889af38e98b3cab2423f442220cf368035ca824e7608f0da745e02c`。导入文件保留原 upstreamSha256，仅更新实际摘要与本地补丁说明。新增测试不写入 source-files.json（该清单只登记导入文件），其摘要记录于本段。

2026-11-17 托管上下文策略持久化：新增自有 overlay/lingtu/context_policy.go 与 context_policy_test.go，定义全局策略、严格校验、加密读取、基于 lingtu_settings 修订号的原子 CAS 保存和安全客户端投影；视觉学习允许开关仅表示策略允许，默认开启但学习任务默认关闭，真正调用仍需模型能力校验。context_policy_test.go 为 SHA256 `41e71b56e59b9ab54759266a8d53301be457615a09603106910153c90026d90b`，context_policy.go 为 SHA256 `9fee2ff5daaaa53ec491123b2bb36a6051eab62bc1f26c31bc07004f8986895c`。导入文件 overlay/lingtu/settings.go 仅为 ManagedSetting 增加 revision 列并保留旧数据默认值，实际 SHA256 更新为 `14632be1462930580c1f7308953a27d8ffcf67bfeea5e843b50d34b20a8f39ae`，原 upstreamSha256 `abe3a0d51749548fc1643503a89a0be8968d4ab09223dbcd2d9daac60c54d48d` 不变。新增文件不冒充上游导入；隐藏提示词与策略原文仍由既有 lingtu_secret 加密，客户端只取得安全投影。

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

服务版本更新为 2026.11.17-cost.1，能力名在生产全集上增加 oken-cny-cost-estimates。摘要走同一 prepareChat 路径，因此沿用价格快照并保存 cost_micros/cost_status，但仍通过 SettleAuxiliary 免扣调用次数；主聊天保留生产原生额度扣费。未修改商户配置字段、密钥序列化、账本唯一键、回调验签或支付 SDK。来源原始 SHA256 保留，最终维护文件哈希在 source-files.json 更新。

## 2026-11-17 cost.2 历史回算与日月报表

服务版本更新为 2026.11.17-cost.2，未改变计费协议和支付能力。新增只读历史当前价格估算字段与报表合计；仅当记录缺少快照和持久化状态、记录渠道与模型精确匹配当前 `CostRateModel` 且用量与单价可用时估算，缓存明细缺失时按普通输入价并显式标注。原 `cost_micros`、`cost_status`、数据库行和 `cache_usage_known` 不变，已有快照优先且不重复计数。日接口保持默认 7/30 天语义，新增 `period=month` 近 12 个自然月、独立 `today`/`this_month` 和严格参数校验；管理网页新增日/月金额卡、分周期金额表与费用图，保留模型筛选和 Token 图。支付、额度、摘要免扣、导入来源 SHA256 及原始上游哈希保持不变。

## 2026-11-19 支持套餐与试用延期（计费补丁已部署）

`overlay/lingtu/billing.go` 在现有支付验签后的入账事务中延长未过期试用有效期，计数独立、重复回调不延期、过期与历史订单不追溯。`quota.go` 仅更新规则注释；原有接口与表结构保留。`overlay/lingtuhost/billing_native.go` 新增默认共创支持包 `support_100000`（100000 分、100000 次、365 天），仍由服务端发布并校验价格与套餐，未修改商户配置或生产账本。相关回归覆盖延期、边界、回滚、重复入账和套餐目录；目录原有数量断言随新增套餐同步更新。上述文件与相关测试的实际 SHA256 已更新到 `source-files.json`，原来源字段与许可不变。验证结果见 `artifacts/billing-support-20261119/validation.md`；正式上线结果见下方部署补充，真实新付款未验收。

本次计费差异已基于实际cost.3源码归档最小部署为 `2026.11.19-support.1`，保留正式网页与其他功能；未把当前主干未上线的模型策略及注册网页一并部署。实际源码/程序摘要、备份、验证和未做事项见 `DEPLOYMENT-20261119-SUPPORT.md`，不表示真实新付款已验收。
