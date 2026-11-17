# 托管模型服务端上下文策略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让管理员在服务端配置托管模型的接待上下文与学习策略，并让保存的版本在桌面检索和服务端模型请求中实际生效。

**Architecture:** 服务端用现有加密设置表保存一份全局、带修订号的策略，管理端编辑完整策略，客户端只取得安全投影。桌面主进程按投影选择已审核知识并携带策略版本；服务端独立执行隐藏提示词、用途、模型与输出额度。此计划交付服务端配置闭环；无 OCR 详情页采集和视频直传分别在后续计划接入同一策略。

**Tech Stack:** Go/Gin/GORM、原生 React/TypeScript 管理页、Electron 主进程 TypeScript、现有 managed-session 与 Vitest/Go 测试。

**Spec:** docs/superpowers/specs/2026-11-17-managed-product-page-learning-design.md

## Global Constraints

- 仅托管模式读取并应用新策略；本机自带 Key 路径保持原有行为。
- 首版只有一份全局托管策略；不添加账号或套餐覆盖。
- 现有 SKU/商品冲突胜出规则、已审核/有效期校验、16K 触发与 8K 压缩目标、人工发送确认门不可由后台改写。
- 管理员保存继续要求原生交互会话、安全证明和审计；客户端不能取得隐藏提示词、供应商凭据、价格或内部模型路由。
- 新的直接详情页学习默认关闭；视频与语音模式固定显示为未开通，直到对应端到端能力通过验收。
- 仅本机隔离数据验证；不部署生产，不使用实店资料或付费模型调用。
- 实施前以最新已集成 main 创建独立工作树，核对同仓库并行改动；不得覆盖当前脏检出。修改 server/overlay 与 vendor 文件时维护来源/哈希清单。

## Review Focus

- 两个管理员用同一修订号保存：后到者得到冲突提示与最新版本，先到者的值不丢失；Task 1/2 测试。
- 提示词含引号、换行和超长 Unicode：合法值原样加密保存，超限值在扣额度前拒绝；Task 1/5 测试。
- 桌面切换账号或托管来源：旧账号的缓存和版本不得进入新请求；Task 6 测试。
- 客户端伪造学习用途、旧修订号或更大输出预算：服务端拒绝或裁到服务端上限，且不绕过账本；Task 5 测试。
- 已审核知识含超长中文、emoji 或动态过期字段：只纳入完整且仍有效的引用，超预算明确省略，发送前仍复核；Task 7 测试。

---

## 文件边界与固定契约

- server/overlay/lingtu/context_policy.go：策略类型、默认值、校验、加密设置读取、修订号条件保存与安全投影；settings.go 只为 ManagedSetting 增加修订号字段并保留旧数据兼容。
- server/overlay/lingtuhost/admin.go：沿用 /api/lingtu/admin/config 的证明和审计，增加 section=context_policy；不要创建第二套管理员鉴权。
- server/overlay/lingtuhost/routes.go：在已有 /api/client/config 中加入安全投影。
- server/overlay/lingtuhost/chat.go：根据用途和策略快照组装模型请求；不信任客户端声明的输出上限。
- server/overlay/web/src/features/lingtu/admin-context-policy.tsx：单独管理页组件；admin-page.tsx 只接入导航、保存和配置类型。
- vendor/lingtu-runtime/electron/managed-session.cjs：只增加定型的 config() 及受限 purpose/policy_version 透传；backend.cjs 只透传明确标记的学习用途；不向 renderer 开放任意请求。
- electron/managed-context-policy.ts：服务端安全投影的 Zod 契约、账号/来源绑定缓存；managed-controller.ts 只提供主进程读取入口。
- electron/knowledge-runtime.ts：在已有审核检索结果上按预算取完整引用；不改变 resolver 的冲突胜出逻辑。

固定 API：管理员 POST section=context_policy，顶层 revision 是预期修订号，context_policy 是不含 revision 的完整候选；GET 管理配置返回带 revision 的完整 context_policy。客户端 GET /api/client/config 增加顶层 policy_version、runtime_context 和 learning，仅含版本、启用状态、检索顺序/预算、允许来源/视觉能力/调用上限、需审核标志。模型请求可选 purpose=reply|learning 和 policy_version；旧客户端省略时按现有回复兼容处理，显式携带旧版本的新请求在预留额度前收到 409。

默认策略 revision=0、接待新规则关闭、隐藏提示词为空、检索预算 3000 token、预算填充顺序 binding→store→canonical→template。管理员可交换 store/canonical 的预算填充顺序；binding 固定最前、template 固定最后，冲突胜出仍由 resolver 决定。新详情页学习关闭；允许来源仅 pdd_detail_text/pdd_detail_image，vision_enabled 默认 true 但只表示策略允许，单商品最多 20 次，服务端学习输出上限最多 4096 token，人工审核固定为 true，video_mode/asr_mode 固定 disabled。没有配置记录时旧聊天不因本功能中断。

### Task 1: 持久化及修订号

**Files:** Create server/overlay/lingtu/context_policy.go、context_policy_test.go；modify server/overlay/lingtu/settings.go。

**Interfaces:** LoadContextPolicy(db *gorm.DB) (ManagedContextPolicy, error)；SaveContextPolicy(db *gorm.DB, expectedRevision int, next ContextPolicyInput) (ManagedContextPolicy, error)；ManagedContextPolicy.ClientProjection() ClientContextPolicy。ContextPolicyInput 不含 revision；提示词最多 8192 UTF-8 字节、预算 256..4096 token、学习输出 512..4096 token；requires_review=false、未知来源、video/asr 非 disabled 均拒绝。

- [ ] **Step 1: 写失败测试。** TestLingtuContextPolicyDefaults 断言无行时 revision=0 且新学习关闭；TestLingtuContextPolicyCAS 断言同一 revision 只能成功保存一次、再次保存返回冲突且旧值不变；TestLingtuContextPolicyValidation 断言超长 Unicode、未知来源及关闭审核被拒；TestLingtuContextPolicyProjection 断言隐藏提示词不在 JSON 投影。
- [ ] **Step 2: 运行目标测试并确认失败。** 先执行 npm run server:prepare，再在 server/.upstream 执行 go test ./lingtu -run TestLingtuContextPolicy -count=1；预期因实现缺失失败。
- [ ] **Step 3: 实现上述三个接口。** 用 lingtu_settings 的加密 Value 保存策略；为 ManagedSetting 增加 revision 列。新行用唯一键插入；已有行用 WHERE name=? AND revision=? 原子更新并检查 RowsAffected，不能先读再无条件 Save。加载失败、密文损坏时返回错误，不假装默认策略。
- [ ] **Step 4: 重跑目标测试。** 同 Step 2，预期 PASS。
- [ ] **Step 5: 只提交本任务文件。** 提交前同步 server/source-files.json 与 server/PROVENANCE.md 的实际改动记录。

### Task 2: 管理员读写接口

**Files:** Modify server/overlay/lingtuhost/admin.go；create server/overlay/lingtuhost/admin_context_policy_test.go。

**Interfaces:** POST /api/lingtu/admin/config 使用 section=context_policy、revision、context_policy；成功返回 saved=true 与新的 context_policy；修订冲突返回 HTTP 409、error=revision_conflict 与最新 revision。GET 管理配置增加 context_policy 完整值，仅 AdminAuth 可读。

- [ ] **Step 1: 写失败测试。** TestLingtuAdminContextPolicyAuth 断言非管理员不能读、非交互会话或无证明不能写；TestLingtuAdminContextPolicySave 断言正确证明、修订号增加、审计 section 与 outcome，未知 JSON 字段被拒；TestLingtuAdminContextPolicyConflict 断言第二次旧 revision 保存为 409 且 GET 值未变。
- [ ] **Step 2: 在准备后的 server/.upstream 执行 go test ./lingtuhost -run TestLingtuAdminContextPolicy -count=1，确认失败。**
- [ ] **Step 3: 接入现有 adminConfig/saveConfig。** 请求体仍受 32768 字节限制，沿用同一请求哈希安全证明与审计；配置校验失败给 400，修订冲突给 409，数据库异常给 503，不在日志打印提示词。
- [ ] **Step 4: 重跑 Step 2，预期 PASS。**
- [ ] **Step 5: 同步服务端来源清单与记录，只提交本任务文件。**

### Task 3: 管理后台可编辑页面

**Files:** Create server/overlay/web/src/features/lingtu/admin-context-policy.tsx、admin-context-policy.test.tsx；modify server/overlay/web/src/features/lingtu/admin-page.tsx、admin-page.test.tsx、server/translations.json。

**Interfaces:** AdminContextPolicy 接收已加载策略、busy 与现有 secure-save 回调。页面显示生效 revision、接待提示词/知识预算与顺序、学习开关/来源/视觉开关/调用和输出上限；视频/语音与人工审核只读。保存使用现有 save()，传完整策略和预期 revision。

- [ ] **Step 1: 写失败界面测试。** 输入修改后未保存时 GET 值不变；保存 payload 含 section、revision 和字段白名单；409 显示“配置已变化，请刷新”，保留未提交草稿；无安全证明不发 POST；按钮和字段在 busy 时禁用。
- [ ] **Step 2: 执行 npm run server:prepare，再在 server/.upstream/web 执行 bun run test src/features/lingtu/admin-context-policy.test.tsx src/features/lingtu/admin-page.test.tsx，确认失败。**
- [ ] **Step 3: 实现独立组件并接入导航和翻译。** 不让浏览器直接调用客户端接口；保留管理页现有的单次安全证明流程。
- [ ] **Step 4: 重跑 Step 2 并执行该网页的 bun run typecheck，预期 PASS。**
- [ ] **Step 5: 更新 server/source-files.json、server/PROVENANCE.md；只提交本任务文件。**

### Task 4: 已鉴权客户端安全投影

**Files:** Modify server/overlay/lingtuhost/routes.go；create server/overlay/lingtuhost/client_context_policy_test.go。

**Interfaces:** GET /api/client/config 保留 default_model/models/max_tokens，新增 runtime_context 与 learning 两个向后兼容字段。投影由 Task 1 的 ClientProjection 产生，不序列化完整策略。

- [ ] **Step 1: 写失败测试。** TestLingtuClientContextPolicyProjection 断言鉴权后字段及 revision；响应原始 JSON 不含提示词、服务器模型路由、密钥或管理员独有字段；未授权为 401；配置密文错误为 503。
- [ ] **Step 2: 在 server/.upstream 执行 go test ./lingtuhost -run TestLingtuClientContextPolicy -count=1，确认失败。**
- [ ] **Step 3: 在原 config handler 装载并返回安全投影。** 不添加公开管理端点，不改变旧字段含义。
- [ ] **Step 4: 重跑 Step 2，预期 PASS。**
- [ ] **Step 5: 更新来源清单与记录，只提交本任务文件。**

### Task 5: 服务端模型请求实际执行策略

**Files:** Modify server/overlay/lingtuhost/chat.go；create server/overlay/lingtuhost/chat_context_policy_test.go；如用途需单独持久化，增量修改同包 managedUsage 迁移。

**Interfaces:** chatInput 新增 purpose 与 policy_version；省略 purpose 的请求沿用旧调用。reply 且接待新规则启用时，服务端在上游请求中放入隐藏规则并按既有 trial max_tokens 执行；learning 要求当前 revision、learning.enabled、允许的模型能力与已鉴权账号，输出上限取服务端策略值（不被旧统一 512 截断）。两种用途仍使用既有 ReserveWithLimits、结算、未知结果与稳定请求 ID；digest 包含用途和版本。上游请求连同隐藏提示词的文字输入按现有计数能力估算，超过 16384 token 拒绝，图片另沿用当前图片限制。

- [ ] **Step 1: 写失败测试。** TestLingtuChatContextPolicyReply 断言上游收到隐藏规则但客户端响应/日志不含规则；TestLingtuChatContextPolicyLearning 断言关闭、旧版本、视觉模型不支持及客户端自报 8192 输出均不能绕过服务端上限；TestLingtuChatContextPolicyIdempotency 断言同 ID 不同 purpose/version 冲突，同 ID 原请求在策略更新后只回放旧结果，不重复扣额度；超输入预算在预留前拒绝。
- [ ] **Step 2: 在 server/.upstream 执行 go test ./lingtuhost -run TestLingtuChatContextPolicy -count=1，确认失败。**
- [ ] **Step 3: 在 prepareChat 中取得单次策略快照并执行。** 客户端系统消息不能覆盖服务端模型路由和额度；服务端隐藏规则置于上游请求，页面与引用资料仍视为不可信输入。人工审核由本机知识库控制，服务端不宣称能证明本地审核状态。保留正常回复的旧客户端兼容；学习调用记 purpose=learning，账号日额度和并发规则不变；单商品次数仍由桌面任务限制。
- [ ] **Step 4: 重跑 Step 2 和既有 chat/idempotency 目标测试，预期 PASS。**
- [ ] **Step 5: 更新来源清单、迁移说明和服务端文档；只提交本任务文件。**

### Task 6: 桌面主进程读取与版本透传

**Files:** Create electron/managed-context-policy.ts、tests/managed-context-policy.test.ts；modify electron/managed-controller.ts、electron/local-runtime.ts、vendor/lingtu-runtime/electron/managed-session.cjs、vendor/lingtu-runtime/electron/backend.cjs；add tests/managed-context-transport.test.ts and vendor/lingtu-runtime/tests/managed-session-context.test.mjs。

**Interfaces:** ManagedSession.config({signal?}) 仅 GET /api/client/config；ManagedController.contextPolicy() 返回通过 Zod 校验的安全投影，缓存最多 60 秒并绑定 apiOrigin+userId；chat payload 只允许 purpose=reply|learning、非负整数 policy_version。KnowledgeModelPort.complete 可选 purpose/policyVersion，只有新托管学习路径显式标记 learning；现有调用保持省略。

- [ ] **Step 1: 写失败测试。** 确认 config 只访问固定路径且 bearer 不进 renderer DTO；缺字段/旧服务端使新学习显示未开通；账号/来源变化或注销清空缓存；学习 purpose/version 原样到达服务端，任意字段与 8192 客户端输出声明被剔除；旧聊天请求正文保持兼容。
- [ ] **Step 2: 执行 npm test -- tests/managed-context-policy.test.ts tests/managed-context-transport.test.ts 与 node --test vendor/lingtu-runtime/tests/managed-session-context.test.mjs，确认失败。**
- [ ] **Step 3: 增加定型 config()、主进程缓存和受限版本透传。** 不扩展 renderer 的 managed-business URL 白名单；策略过期或读取失败时新学习关闭，既有聊天使用服务端自身约束继续。
- [ ] **Step 4: 重跑 Step 2、npm run typecheck、npm run check:vendor，预期 PASS。**
- [ ] **Step 5: 更新 vendor/source-files.json、vendor/lingtu-runtime/PROVENANCE.md 与桌面文档；只提交本任务文件。**

### Task 7: 接待知识预算在本机生效

**Files:** Modify electron/knowledge-runtime.ts、electron/knowledge/resolver.ts（仅在现有结果无法保留检索命中顺序时）、electron/local-runtime.ts；create tests/managed-knowledge-budget.test.ts。

**Interfaces:** 托管接待读取 Task 6 的当前安全投影；只对 runtime_context.enabled=true 的请求应用 3000 token 默认上限或管理员保存值。先由现有 resolver 完成已审核、范围、冲突和有效期过滤，再按可配置的 store/canonical 顺序填入完整 citation；估算使用现有上下文 token 计量，不截断 question/answer/sourceRefs。返回的引用仍由现有发送前 validateCitations 复核。

- [ ] **Step 1: 写失败测试。** 同一商品的 binding 覆盖保持不变；交换 store/canonical 只影响预算填充；超长中文/emoji 使完整条目被省略而不被裁断；撤回或过期引用不进入结果；本机 Key 与未启用策略仍使用既有路径。
- [ ] **Step 2: 执行 npm test -- tests/managed-knowledge-budget.test.ts，确认失败。**
- [ ] **Step 3: 实现预算选择并在主进程接线。** 先一次性估算候选引用的 token 成本，保留来源修订号与 omitted 计数；不可把通用表达当商品事实。16K/8K 压缩与统一发送门不变。
- [ ] **Step 4: 重跑 Step 2、相关 knowledge/review 目标测试和 npm run typecheck，预期 PASS。**
- [ ] **Step 5: 更新 docs/CONTEXT_COMPRESSION.md、docs/MANAGED_SERVICE.md、docs/DECISIONS.md；只提交本任务文件。**

### Task 8: 集成与可审阅验收

**Files:** Update docs/VALIDATION.md、docs/HANDOFF.md；如验证器没有运行新增测试，modify server/scripts/verify.ts 的定向测试匹配。

- [ ] **Step 1: 在隔离库跑 npm run server:verify、npm run check:vendor、npm run test:upstream、上述桌面目标测试与 npm run typecheck。** 核对退出码、server/artifacts/verification.json 和实际管理页构建；不把构建当作生产验收。
- [ ] **Step 2: 用本机回环管理员页面和模拟托管模型做闭环。** 修改并保存策略，确认 GET /api/client/config 版本变化且无隐藏提示词，确认上游模型请求的规则/输出上限与账本用途，确认桌面换店、换账号和撤回后引用失效。
- [ ] **Step 3: 记录实际完成、未测项和下一阶段入口。** 下一计划先复用现有平台采集接无 OCR 的详情文字/图片；视频计划待同区域上传、视频模型和云 ASR 路径各自通过隔离能力试验后执行。
- [ ] **Step 4: 审查本任务 diff、来源清单与提交范围；将集成结果提交并按已授权的项目流程推送/检查构建。** 不发布安装包或部署生产。

## 计划自审

本计划覆盖服务端编辑、加密持久化、版本冲突、安全投影、桌面读取、服务端真实执行、接待知识预算及兼容/审计。商品详情页无 OCR 与视频媒体属于设计稿后两项独立子项目，本计划不把策略开关或图片海报当作已完成的视频学习。执行时以当前 main 和并行分支的实际文件为准，新增测试名保留 TestLingtu 前缀，以进入现有 server:verify 的筛选范围。
