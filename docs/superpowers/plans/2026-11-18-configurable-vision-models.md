# 可配置图片识别模型实施计划

> **For agentic workers:** 本计划由本机 DeepSeek Harness 按任务实施；Codex 独立检查、验证与整合。每项以复选框跟踪。不得部署或发布。

**Goal:** 让本机用户独立配置图片识别 API，并让托管管理员选择通过图片能力验证且获授权的视觉模型渠道。

**Architecture:** 本机视觉设置与现有文字模型设置分开保存，旧配置默认沿用文字模型；Key 通过 Electron 主进程安全存储。托管端把视觉路由 ID 保存到现有试用策略，由服务端校验已连接渠道、视觉探测状态及授权范围后执行路由，客户端只获得可用能力投影。

**Tech Stack:** Vue 3、TypeScript、Electron、Zod、Go、GORM、现有 New API channel relay 和 React 管理页面；不新增运行时依赖。

**Spec:** `docs/superpowers/specs/2026-11-18-configurable-vision-models-design.md`

## 执行状态（2026-11-19）

- Task 1 本机领域、公共装配、五个业务命令、快照六字段、设置页挂载和知识图片路由已实现；55 项视觉专项和 2 项公共装配测试通过，另复用登录/后端契约测试。
- Task 2/托管视觉属于独立 server 分支，由 root 最后合并；本分支不声称托管视觉已交付。
- 计划中的 1.0.58 版本指令是历史基线；当前主线为 1.0.73，本分支不抢升版本，由最终交付统一处理。

## Global Constraints

- 本机文字模型和图片模型分开配置；缺少新增配置的旧快照解释为沿用文字模型。
- API Key 只在 Electron 主进程加密保存；快照、日志和托管客户端不包含密钥原文。
- 本机图片能力只有实际图文请求成功后才标记验证通过；端点或配置改变后要求重新验证。
- 托管图片路由只能由服务器决定；候选必须启用、连接验证成功、图片能力验证有效并包含在试用授权范围中。
- 旧托管策略继续原有 Qwen3-VL 行为；不要静默切换模型或自动扩展额度、授权范围。
- 图片请求在视觉渠道不可用或授权不足时，应在额度预留前失败；成本和用量记录实际视觉路由。
- 不调用真实买家资料，不部署生产，不发布安装包，不新增模型 SDK 或其他运行时依赖。
- 按项目交付规则将版本从 1.0.57 增至 1.0.58，并同步 `package-lock.json`；仅一次。

## Review Focus

- **旧本机配置缺少视觉字段**：需继续使用文字模型，未误报视觉验证。归入 Task 1。
- **视觉 Key 更新、删除或同时保存文字配置**：配置互不覆盖，快照/日志不泄露原文。归入 Task 1。
- **只通过文本连接、或图片模型配置变更后**：不可显示视觉已验证；只能在实际图片测试成功后启用。归入 Task 1。
- **托管策略没有新视觉路由字段**：旧策略仍按 Qwen3-VL 处理；失效时明确失败而不切换文字模型。归入 Task 2。
- **托管候选未授权、验证过期或被禁用**：保存被拒或路由在额度预留前失败，且客户端无法覆盖模型选择。归入 Task 2。

---

### Task 1: 本机图片模型设置与隔离路由

**Files:**

- Modify: `src/shared/contracts/backend.ts` — 视觉配置与 capability 的白名单快照、命令契约。
- Modify: `electron/local-runtime.ts`、`electron/model-capabilities.ts`、`electron/knowledge-runtime.ts`、相关模型装配文件 — 视觉配置/凭证读写、实际图片路由与验证状态。
- Create or modify: `electron/vision-model-settings.ts` — 独立视觉设置校验、身份摘要及旧值迁移逻辑（按现有模块模式实现）。
- Modify: `src/modules/settings/components/LoginDialog.vue` 及设置模块组件/样式 — “沿用文字模型 / 单独配置”、密钥状态、连接与图片验证反馈。
- Modify: `tests/model-capabilities.test.ts`、`tests/knowledge-model-learning.test.ts` 或新增聚焦测试 — 配置回退/切换、模型分流及密钥边界。
- Modify: `docs/LOCAL_INTEGRATION.md` — 设置使用与验证说明。

**Interfaces:**

- 增加视觉模型设置对象，至少包含 `mode: 'inherit' | 'custom'`、`baseUrl`、`model` 和非敏感的 `apiKeyConfigured` 快照状态；API Key 本身只能进入主进程命令，不进入快照。
- 创建独立视觉模型完成端口，知识图片请求通过它发送；文字请求继续使用既有模型端口。
- 保存视觉配置时只改变视觉配置；保存文字配置时只改变文字配置。视觉模型能力由其真实图片验证状态决定。

- [x] **Step 1: 写本机配置与路由失败测试。** 覆盖旧配置继承、独立模型分流、视觉 Key 不外泄、改动端点/模型后验证失效、普通文本成功不能冒充图片验证成功。
- [x] **Step 2: 运行上述测试确认失败。** `npm.cmd exec vitest run tests/model-capabilities.test.ts tests/knowledge-model-learning.test.ts`；预期新场景失败。
- [x] **Step 3: 实现独立配置、安全保存和模型端口。** 视觉配置的 Key 复用 `safeStorage`；创建本机固定测试图片的显式图文验证操作；不修改 vendor 上游文件，除非证明现有注入点无法满足需求并在交付中说明。
- [x] **Step 4: 在设置中加入视觉区块。** 预设含 DeepSeek；自定义模式支持兼容 API 地址、模型选择/输入与新 Key；只显示 Key 已配置状态；验证按钮只在用户点击时执行。
- [x] **Step 5: 重跑本机聚焦测试与类型检查。** 预期继承、分流、密钥隔离、图片验证失效场景通过；现有知识学习文字模型行为不变。

### Task 2: 托管视觉渠道验证与可选路由

**Files:**

- Modify: `server/overlay/lingtu/settings.go` 或当前 `TrialPolicy` 所属文件 — 可选 `vision_model` 策略字段及旧值默认。
- Modify: `server/overlay/lingtuhost/vision.go`、`admin.go`、`admin_models.go`、`model_policy.go`、客户端能力/聊天处理文件 — 渠道图文验证状态、策略校验、图片路由、准入前失败。
- Modify: `server/overlay/web/src/features/lingtu/admin-page.tsx`、`admin-models.tsx` 及邻近类型/客户端 — 视觉验证操作和试用策略图片路由选择。
- Modify: `server/overlay/lingtuhost/model_policy_test.go`、`vision_test.go`、`admin_model_default_test.go` — 服务端策略与请求保护。
- Modify: `server/overlay/web/src/features/lingtu/admin-page.test.tsx` 及必要渠道页面测试 — 候选状态、无候选、授权错误和过期验证展示。
- Modify: `docs/MANAGED_SERVICE.md`、`docs/HANDOFF.md`、`docs/DECISIONS.md` — 策略兼容和管理员操作。

**Interfaces:**

- `TrialPolicy` 增加可省略的 `vision_model` 字段；旧策略无该字段时保持原 Qwen3-VL 路由语义。
- 视觉验证状态绑定渠道 ID、模型/端点/凭证配置摘要与渠道修订；任何相关配置变化或渠道停用使该状态无效。
- Admin 策略 DTO 返回可选视觉候选及每个候选的 ready/verified/allowed 状态；保存请求显式包含 `vision_model`，服务端再次校验，不信任前端选项。
- `imageModel(selection)` 根据显式策略选择唯一候选，且必须满足当前范围授权；绝不使用客户端 `model` 字段覆盖视觉路由。

- [ ] **Step 1: 写服务端策略与路由失败测试。** 覆盖旧策略 Qwen 兼容、选中授权视觉模型、未验证/过期/禁用/未授权候选拒绝、客户端不能覆盖，以及额度预留前失败。
- [ ] **Step 2: 运行服务端聚焦测试确认失败。** `go test ./overlay/lingtuhost ./overlay/lingtu`（从 `server` 目录执行）；预期新策略场景失败。
- [ ] **Step 3: 写管理员页面验证测试。** 覆盖已验证可用选项、无候选提示、授权缺失提示和过期状态。
- [ ] **Step 4: 实现渠道图片能力探测。** 仅管理员显式触发固定非客户测试图片；验证成功状态与通道配置摘要/修订绑定；文本测试不设置视觉状态。
- [ ] **Step 5: 实现 `vision_model` 策略读取/保存与请求路由。** 旧策略默认 Qwen；新选择必须在授权范围内且视觉验证有效；图片账单按实际渠道模型记录；额度预留之前拒绝失效请求。
- [ ] **Step 6: 在管理页加入视觉模型选择。** 候选只显示 ready + verified + authorized 的托管模型；选项旁显示渠道名/上游模型；保存前端和后端均校验，不自动扩展授权。
- [ ] **Step 7: 重跑服务端聚焦测试和页面测试。** 预期旧策略兼容、错误拒绝、用户不可覆盖路由及页面状态测试通过。

### Task 3: 版本、文档与跨层验收

**Files:**

- Modify: `package.json`、`package-lock.json`、`docs/VERSIONING.md` — 同批版本提升至 1.0.58 并记录改动。
- Modify: 本计划与设计稿状态、`docs/HANDOFF.md` — 填写交付范围、验证结果和未解决限制。
- Review: Task 1/2 所有改动及 git diff；检查 `vendor/PROVENANCE.md` 与哈希清单无非必要变化。

**Interfaces:** Task 1 的本机视觉配置与 Task 2 的托管视觉路由保持各自安全边界；共用的 UI 只呈现当前模式，不合并或同步两边的 API Key。

- [ ] **Step 1: 执行本机和服务端聚焦验证。** 运行 Task 1/2 命令及本机类型检查/相关 lint；不得运行无关全量验收。
- [ ] **Step 2: 检查模型用量与错误路径。** 以本地模拟模型确认图片走所选视觉端口、文字仍走文字模型；以隔离数据库验证托管成本归属与额度拒绝顺序；不触发真实 DeepSeek/Qwen 付费请求。
- [ ] **Step 3: 提升版本并同步交接记录。** `1.0.57 → 1.0.58`；核对 `package-lock.json` 顶层与 package.json 一致。
- [ ] **Step 4: 由 Codex 独立审查 DeepSeek 交付。** 核对 diff、日志、测试退出状态及构建结果，修复发现的问题后重验。
- [ ] **Step 5: 本机源码运行验收。** 仅在不会打断其他项目工作的情况下重启灵兔，确认设置入口和版本显示；不安装打包版、不公开发布、不部署托管服务器。
- [ ] **Step 6: 交付代码。** 提交并推送隔离功能分支，检查 GitHub Actions 构建；如存在可下载构建产物，下载到本机隔离目录并启动验收。不得合并 main、发布 Release 或部署服务端。

## Execution Notes

- 本机 DeepSeek 仅在该计划对应的独立 Git worktree 修改；允许范围限于 `client` 项目源码和上述文档/测试。不得切换、重置或覆盖主工作区文件。
- DeepSeek 通过 NDJSON 记录事件和诊断；成功须同时满足退出码 0、最终事件 `final.reason.kind=completed`，并由 Codex 独立验收文件与验证结果。
- 不向外部模型请求发送用户 API Key、客户图片、买家消息、私有源码或生产密钥。视觉 API 验证使用固定合成图片和模拟端点；真实 DeepSeek 试用由用户之后在应用内显式点击验证。
- 按既有协作授权提交并推送隔离功能分支、核对 CI；不合并 main、不部署生产、不发布 Release、不调用真实付费模型。
