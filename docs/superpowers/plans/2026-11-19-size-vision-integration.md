# 尺码规则与可配置视觉模型 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成保留的尺码草稿和视觉规划，移除用户指定的工单登记入口及页面，保留现有数据和其余功能，验收后合入 main 并打开源码最新版。

**Architecture:** 尺码规则采用独立 TypeScript 领域，经现有 runtime 命令和模型证据端口接线；原自由文本知识入口保留。本机视觉配置使用独立加密配置，经已有知识模型端口分流图片请求；托管视觉在现有授权和渠道层完成路由。桌面和服务端使用不同 worktree，公共装配由桌面统筹单 worker 修改。

**Tech Stack:** 现有 Vue 3 / Element Plus 2.8.8、TypeScript、Zod 4.6.7、PapaParse 5.7.1、Electron safeStorage；server 固定 Go/React 上游。无新增依赖。

**Spec:** 原尺码依据 `6235fd0` 的 `electron/size-specifications.cjs`、React 页面、测试及功能账本；视觉依据主目录保留的 `docs/superpowers/specs/2026-11-18-configurable-vision-models-design.md`。本计划明确取代旧版本号及旧禁止合主干的交接状态，其余业务规则延续。

## Global Constraints

- 本机 DeepSeek 执行，Codex 独立复核、验证和整合。
- 现有真实资料、模型设置、AI 开关、候选审批及 PDD 会话/发送保护保持兼容。不得调用真实付费模型、发送买家消息、发布 Release 或部署生产服务器。
- 只在隔离工作树写产品文件；主目录两份未跟踪视觉文档先按哈希备份原件，再把更新稿纳入 Git；旧 stash 原样保留。
- 自有业务使用 TypeScript，无 any/ts-ignore，不改 vendor；组件通过模块服务访问现有 runtime。
- 日常只运行新增和直接受影响测试、类型检查、构建与相关界面验收；不得以覆盖截图基准掩盖回归。
- 最终整合以当时最新 main 为基线，仅在交付时递增一次 patch 并同步 lock；当前主目录已推进到 1.0.73，不能覆盖其改动或交付旧的 1.0.69。不得把源码版本冒充未重启进程。

## Review Focus

- 同店同商品的停用规则也占用绑定；不同店相同编号不得串用，失效商品不得进入证据。
- 单位换算、闭区间边界和换被测人后，eligibleLabels 必须正确；输出范围外推荐必须被阻止。
- 配置/工作区改变期间的迟到保存、验证和模型响应不能写入新状态。
- 普通文字成功不能冒充图片验证；新视觉验证绑定实际端点、模型、Key 版本且无密钥泄漏。
- 托管图片路由失败必须在额度预留之前返回；成功用量计入实际渠道/模型，旧无配置 Qwen 路由兼容。

## Task 1: 尺码领域与现有接待/训练/UI 接线

**Files:** 新增 `src/shared/contracts/size-rules.ts`、`electron/size-rules/{store,validate,context,table,service}.ts`、知识模块服务/编辑组件及 `tests/size-rules-*.test.ts`。增量修改 `ShopKbPanel.vue`、`electron/local-runtime.ts`、现有知识/训练端口和 `src/shared/contracts/backend.ts`；不修改 server。文档更新知识模块 README 及专项尺码说明，最终公共交接由统筹整合。

**Interfaces:** 服务接收当前数据目录、assertActive、真实店铺商品目录验证端口；暴露 execute(action,payload) 和 resolve(storeId,productId,question,thread) 证据方法。命令固定为 list-size-rules、save-size-rule、remove-size-rule、preview-size-table、export-size-table、size-rule-template。渲染层只调用现有 runtime.execute；接待与训练调用同一证据方法，不新增发送入口。

- [ ] Step 1: 从旧草稿提取业务语义，先写测试：同店绑定冲突含停用、跨店同号隔离、CAS 冲突/重启/损坏文件保留、换算闭区间、缺测量澄清、范围外推荐拒绝；运行并保存 RED。
- [ ] Step 2: 实现有界 DTO、完整校验、临时文件 flush/rename 原子存储及 revision/version CAS。规则名 1..100；列 1..12，行 1..100；绑定 0..500；无效商品拒绝保存并在读取证据时再次核对。
- [ ] Step 3: 实现同源证据与推荐约束。单位 mm/cm/m、g/kg/斤、mL/L、件、岁、°C、none；仅温度允许负值，有限数且绝对值不超过 1e9，闭区间 min≤max。只在选码缺测量时追问，普通问候/指定尺寸查询不追问；不估照片尺寸、不杜撰库存。超过证据预算显式要求指定规格，不能截断 JSON。
- [ ] Step 4: 用 PapaParse 实现导入预览与 CSV 导出（拒绝无效单元格、列数不符和超过 1MB；导出防公式注入并验证往返）。空白/女装/男装/鞋/收纳模板不自动启用、绑定或打开 AI。
- [ ] Step 5: 在尺码页加入规则表编辑、真实商品多店绑定、启停/删除确认、失败保留草稿及明确空/错误状态；保留自由文本知识入口和原资料，保留 data-v。用组件测试验证换店迟到结果、失败草稿、表格编辑/模板与绑定交互。
- [ ] Step 6: 运行 size 专项和受影响接待/训练测试、vue/electron 类型与边界检查、build；记录实际命令/结果和接线契约，提交本任务文件，不 bump 版本。

## Task 2: 本机独立视觉配置

**Files:** 新增 `electron/vision-model-{settings,runtime}.ts`、`src/shared/contracts/vision.ts`、`src/modules/settings/components/VisionModelSettings.vue` 与专项测试；修改模型能力、知识端口装配、LoginDialog 挂载及模块服务/预设。独立工作树可先完成新增文件；公共装配在 Task 1 复核后交同一统筹 worker 顺序接线，不争用 local-runtime。

**Interfaces:** mode='inherit'|'custom'；命令 save-vision-model-settings、probe-vision-model、verify-vision-model、clear-vision-key；快照 capabilities.visionModel 只投影 mode/baseUrl/model/apiKeyConfigured/status/reason，不含明文/密文/Key 指纹。视觉配置独立文件保存，safeStorage 仅主进程使用。

- [ ] Step 1: 先验证旧缺文件仍 inherit，文字/视觉互不覆盖，普通探针不置图片验证，变更端点/模型/Key/目录使验证失效；mock 回环断言实际含图 body 到视觉端点、文字仍原端口、Key 不跨端点且不出快照/日志。
- [ ] Step 2: 实现独立原子配置及系统加密 Key，safeStorage 不可用拒绝保存（禁止 base64 降级）；旧配置继承保持原图片可用性但标为未验证；custom 需显式固定合成图验证通过，连接测试不能代替。
- [ ] Step 3: 在现有 onKnowledgeModel 注入点按真实 image_url 内容分流，不按名称推断、失败不静默回退；文字回复/摘要/训练保持文字模型。此批独立配置覆盖知识图片学习；现有买家图片回复流程保持原行为并明确范围，不新增付费处理链。
- [ ] Step 4: 验证与保存检查 workspace 租约、并发配置摘要；配置变更使学习计划重新估算，已发布知识不受影响。固定图使用非客户内置像素和可核对答案，不能只接受任意成功文本；内部图片探针不得放宽正常图片来源策略。
- [ ] Step 5: 在模型设置挂载继承/独立选项、端点/模型/Key、清除 Key 确认、普通连接/图片验证分开按钮与状态，错误保草稿，验证必须显式点击。新视觉预设可使用官方当前 deepseek-flash，不改用户文字设置。
- [ ] Step 6: 运行专项 mock/组件测试、受影响模型/知识测试、类型/边界/build，更新专项视觉说明与 settings README；提交本任务，不 bump 版本。

## Task 3: 托管视觉渠道与管理员界面（独立 server 工作树）

**Files:** 只修改 `server/overlay/lingtu/{settings,model_connection}.go`、`server/overlay/lingtuhost/{model_policy,vision,chat,admin,admin_models}.go`、`server/overlay/controller/lingtu_channel.go`、对应测试及 `server/overlay/web/src/features/lingtu/` 类型/模型设置/管理页面/测试。可按职责新增 overlay 文件，必要时最小 patch+PROVENANCE/哈希；不编辑生成的 .upstream 作为源码，不编辑桌面公共文件。

**Interfaces:** TrialPolicy 新增可选 vision_model；配置请求使用 \*string 保留省略/清空差别。ModelConnection 增 ImageTestStatus/ImageTestedHash/ImageTestedAt；客户端只得可用能力，不得上游地址/Key/内部渠道号。新管理员 action=verify_vision，绑定 connection_id/revision/configHash。

- [ ] Step 1: 写先失败测试：旧无字段 Qwen 路由兼容；显式候选必须 ready+有效图片验证+已有授权；禁用/过期/未授权在 reserve 前拒绝、上游0次且账本不变；请求不能覆盖路由；成功记录实际视觉渠道成本。
- [ ] Step 2: 实现 visionRoute：vision_model 为空沿旧 imageModel；非空严格校验当前配置 hash、渠道状态/凭证和 selection.allows，不自动扩展 allowed_models。显式无效设置事务拒绝且不改变旧策略。
- [ ] Step 3: 固定合成图管理员验证复用现有 relay，只更新图片验证记录、不创建 managedUsage/额度；配置变更/禁用立即失效，普通文字测试不赋图片能力；异步旧结果 CAS 拒绝。
- [ ] Step 4: 管理界面分别展示文字连接和图片验证，只有已授权且 ready+verified 候选可选；保留空字段旧路由。客户端不能指定其他视觉上游；失败显示明确原因。
- [ ] Step 5: 仅运行受影响 Go 包/用例及 server 前端相关测试/类型/lint/build（使用现有 prepare 和 Generator，Bun cache 已有）；维护 overlay/patch 哈希，写交接报告并提交，只提交 server 范围，不 bump 桌面版本。

## Task 4: 复核、整合、主干与本机打开

- [ ] Step 1: Codex 对每域提交检查需求及代码，复核测试日志；单独检查原资料兼容、严格发送门、Key 脱敏、原子写、异步失效和额度预留顺序。问题交原 DeepSeek 会话修复并复查。
- [ ] Step 2: 合并最新 main 及已复核领域分支，保留 1.0.70 配置接口、1.0.71 知识库训练迁移、1.0.72 自动保存及 1.0.73 嵌入式配置；交付时统一递增一次 patch，更新 ARCHITECTURE、LOCAL_INTEGRATION、CONSTRAINTS、DECISIONS、HANDOFF 和专项说明，保留旧草稿原件。
- [ ] Step 3: 运行最终受影响集合/类型/build/格式和架构边界；用隔离合成资料与本机 mock 做尺码编辑/绑定/训练、视觉配置/验证失败与成功 UI 验收；不得调用真实 Key 或真实平台发送。
- [ ] Step 4: 确认 main 未新增冲突改动，保留用户未跟踪文档和规则文件改动后快进主干，按既有授权推送并跟进同次检查；不额外启动打包/下载。通过后只重启本项目源码，使用原 userData，确认实际运行版本与交付版本一致。
- [ ] Step 5: 写入实际完成范围、验证证据和剩余实店/真实模型限制，给用户简短交付。

## 复用依据与执行判定

- Element Plus：<https://github.com/element-plus/element-plus>，MIT；复用已安装 2.8.8 表格/表单，不引入新版本 API。PapaParse：<https://github.com/mholt/PapaParse>，MIT，复用已安装 5.7.1。现有 Zod/原子存储/模型端口优先于新库或通用路由。
- DeepSeek 官方当前视觉模型名依据 <https://api-docs.deepseek.com/news/news260910/> 与 <https://api-docs.deepseek.com/updates/>；预设不能代替实际图片验证，自动测试只用模拟端点。
- Ruling：用户已经指定旧草稿完善、DeepSeek 执行及通过后合主干/打开；此计划将既有选定方案转为当前架构任务，按已有授权连续执行。买家图片独立路由不在本轮既有知识图片配置设计范围内，保持原路径并明确交接。
- Ruling：本机视觉新增领域文件与尺码无共享写入，在第三工作树先实现；待尺码通过后统一接线，避免无效串行等待。视觉基础 worker 不改 backend/local-runtime/知识装配/现有 LoginDialog，实际公共接线留给后续同一统筹 worker。
- Ruling：视觉原始两份规划也是本次要求合入的对象，不能交付后仍作为未跟踪待办。原件已复制至验收目录并核对 SHA256；统筹在隔离树更新同名规划以反映最终实现，主目录合并前再次核对并保留原件备份，避免覆盖未保存资料。
- Ruling：2026-11-19 检查发现主目录已到 9ab671a / 1.0.73，本批先合并最新主线再接线。尺码约束还须覆盖现有知识库 `trial` 主训练入口，保留旧 start-training 兼容；复用最新 `LINGTU_DESKTOP_CHECKS` 定向原生验收机制，不另建验收框架。已通过且源码及环境未变的领域证据直接复用。
- Ruling：用户最新截图明确移除“客服工单／工单登记”。删除菜单、独立本机/团队登记页面及失效的快捷登记按钮；保留工单历史、辅助中心的查看/跟进、平台工单和后台服务。旧链接安全回落，不擦除本机或服务端记录。
- Ruling：用户新增前端文案规则：新界面只保留操作、状态、费用和必要后果提示，移除固定 PNG、验证套件、CAS、开发阶段等实现说明；维护约束保存在开发文档中。
- 自查：三个领域有各自测试与提交边界；size/vision 的公共装配顺序执行，server 独立；五项 Review Focus 均在所属任务中有具体验证。
