# 第二轮维护整理 Implementation Plan

> **For agentic workers:** 本机 DeepSeek 按任务执行，Codex 独立复核、验收和整合；用户已明确要求继续整理，不再等待重复确认。实现沿用项目现有 Vue composable 和 TypeScript 工具链。

**Goal:** 清除确证无消费者的还原残留，减少当前说明重复和过期描述，分离知识库管理器的独立职责，保持所有现有功能。

**Architecture:** 应用/模块/shared 依赖方向、路由和持久化契约不变。manager 继续拥有草稿、审核、账号/店铺租约和销毁；商品家族维护与待学问题处理只通过显式端口接入，不新建客户端或改变生命周期。

**Tech Stack:** 既有 Vue 3、TypeScript 5.7、Vitest 2、Electron 43。分析复用 rg 和临时 npm 缓存中的 Knip 6.39.0，无项目新增依赖。

**Spec:** 用户本聊天要求及 AGENTS.md、docs/CONSTRAINTS.md；基线 1e041f1 / 1.0.58。此前整理及验收见 2026-11-17-maintenance-cleanup.md、docs/1.0.58-acceptance.md。

## Global Constraints

- 代码写入仅在 E:\codex-builds\lingtu-maintenance-cleanup-20261117；保留主目录另一个视觉模型任务的未跟踪文档。
- server/vendor、真实 userData、模型凭据和平台数据不变；不做真实发送、付费调用、发布或部署。
- 不删路由兼容跳转、主进程共享同步/备份/回滚、preload/MCP/fixture 构建入口、仍被模板引用图标、仍使用的 demo 或 legacy CSS。
- 不按行数拆文件；本轮不改正在另一任务维护的视觉模型配置、平台适配器和 local-runtime 装配。
- 日常只执行直接影响的测试、类型/静态和原生检查；不在本机重复全量 Release 检查。
- Codex 最后统一递增一次 patch、整合、推送并核对标准 CI，随后重开正常主目录实例并核对版本与原资料路径。

## Review Focus

- 图标模板、自定义组件、构建脚本字符串入口和动态加载可能使静态分析误报；删除前同时核对实际引用与项目配置。
- 同款重关联的完整 binding revision 集合、SKU 限制和预览内容不能改变；移除操作不能扩大作用范围。
- 待学问题切换店铺/账号、请求迟到、卸载与失败反馈保持原租约保护；状态更新不生成或发布答案。
- 草稿保存/关闭顺序、公开返回属性与函数、分页和刷新顺序保持一致；不把租约复制成第二套所有者。
- 当前权威说明和历史设计/验收分别保留；历史失败不改写成成功，不将历史记录整篇当重复删除。

## Task 1：确认候选与基线

- [x] 检查系统、工作区、工具入口、上轮证据和未提交修改；复用现有独立工作树。
- [x] 调研成熟工具：[Knip](https://github.com/webpro-nl/knip)（ISC，支持 TS/Vue，存在构建/动态引用误报）；仅作候选扫描，不用自动删除。评估 ts-morph 后选择已锁定 TypeScript API，无需再引入重构库。
- [x] 保存候选与诊断到 ignored artifacts/maintenance-round2；6 文件 / 81 项直接相关基线测试通过。
- [x] DeepSeek 只读审计与 Codex 独立引用核对，写明实际采用和保留项。

## Task 2：清除无消费者残留与统一说明

**Files:** 候选仅限 Knip 结果中的 19 个 modules/demo 工厂、39 个 shared/icons、shared/ui/ShopPanelShell.vue、shops/contracts.ts 与相应导出、sync 的两个空转导文件、developer-debug/index.ts；最终删除清单必须有引用核对证据。

**Docs:** AGENTS.md、src/app/router.ts 的过期注释、docs/ARCHITECTURE.md、LOCAL_INTEGRATION.md、PROJECT_LAYOUT.md、有关模块 README；历史 parallel/INTEGRATION.md 只补历史状态与当前权威链接，保留原验收事实。没有字节重复文档则不凑删除数量。

- [x] 每个删除项核对 import、模板、字符串路径、构建 entry、测试及动态加载；保留所有存在消费者的符号。
- [x] 删除确认残留，更新对应导出和失效说明；重复运行引用查询、模块边界和类型检查。
- [x] 当前架构/接线/操作文档按职责互链；删除重复陈述或修正过期内容，不新增另一份功能说明。

## Task 3：按业务职责拆知识库管理器

**Files:** src/modules/knowledge/manager-controller.ts；新增 product-family-controller.ts、miss-controller.ts（名称可按实际职责调整）；模块 README、架构职责地图。

**Interfaces:** 使用和 catalog/maintenance/product-learning controller 相同的显式 options/Ref 注入模式。product-family 持有创建/元数据/同款关联及删除预览状态与原对应方法；miss 持有状态筛选/处理反馈及原对应方法。client、saveDraft、closeEditor、refresh、租约检查仍由 manager 提供。

- [x] 原样移动职责与必要状态，保持 useKnowledgeManager 返回属性及顺序、方法签名和文案不变；不扩大语义修复。
- [x] 复用既有 knowledge-manager（含跨店/长问题/关联）、knowledge-miss-feedback、durable-learning-ui、store-backup、navigation、boundaries 测试；仅在已有测试未覆盖搬移风险时增加行为回归。
- [x] 运行 typecheck、变更文件 ESLint/Prettier、build、边界检查与知识库主专项/待学问题原生检查；保留失败日志并查明原因，不修改原断言掩盖失败。

## Task 4：复核与最终验收

- [x] Codex 核对每个删除项和新职责边界、公开返回契约及生命周期；独立审查发现的问题回交原 DeepSeek 会话修正。
- [x] Codex 独立复跑受影响测试与原生知识/导航/监控；独立 56 项通过、旧首页/监控/CMD 3 项通过，退出 0/completed 与产出已核对；后置 Knip 文件候选为空。核对 DeepSeek 退出 0、final.reason.kind=completed 和实际产出。
- [x] 更新 HANDOFF/VALIDATION 和本计划，最终版本 1.0.60；成果已提交并推送独立分支，未覆盖其他任务。
- [x] 核对精确 CI 提交 f89f186 与标准产物、下载清单/三份 SHA256 和本机便携包 10 项检查；本次无 GitHub Release 或生产部署。
- [ ] 主目录 PDD 实店测试结束或用户明确选择后，整合双方最新成果并验证组合影响，再重开正常主目录实例，核对版本和原 userData。当前保留原现场，不将隔离实例当作切版完成。

## 实际结果

- Task 2：按 `deletion-candidates.json` 删除 63/63 项（19 个旧 demo、39 个共享图标、ShopPanelShell、shops/contracts.ts 与 GoodsRow 导出、sync 两个空转导文件、developer-debug/index.ts）；引用、模板、字符串入口和构建入口复核无外部消费者，仍使用中的资源保留。当前说明已按实际删除/职责更新，历史验收未改写。
- Task 3：新增 `product-family-controller.ts`、`miss-controller.ts`；manager 保留唯一草稿/审核/租约/client 守卫/销毁 owner。公开返回对象 126 项及顺序与 before 快照完全一致；manager 1463 → 1323 行，新控制器 192 + 76 行。
- 验证：6 文件 81 项在 `--no-file-parallelism` 重跑通过；删除领域 4 文件 27 项通过；typecheck、ESLint、Prettier、build、boundaries、diff-check 通过；知识主专项 18 项、misses 2 项、inline progress 5 项原生通过。首次 Vitest 临时 EBUSY 与独立 `--maxWorkers=1` 参数冲突的原始日志分别为 `vitest-first-ebusy-raw.log`、`vitest-maxWorkers-option-failure.log`；未改断言，serial 6 文件 81 项重跑通过。
- Codex 独立复核已完成：56 项独立测试、旧首页/监控/CMD 3 项原生检查通过，退出 0/completed 与产出已核对；后置 Knip 文件候选为空。最终 1.0.60 构建后旧首页再验1/1通过并目视核对版本。
- [CI 44148308838](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44148308838) 对 f89f186 全部通过：源码169文件/1268项、原生桌面91/91、知识库与来源学习、NSIS/ZIP打包及真实打包程序10项。下载 release/ci-f89f186 的版本/提交和三份SHA256匹配，同ZIP本机首次10项通过。
- 本机未重复全量 check/desktop/upstream；全量和打包由标准CI执行。未进行真实平台/付费模型/买家发送验收，未发布GitHub Release或部署生产。
- 当前只在独立分支交付，尚未合入主目录/远端main和重启日常应用。主目录在整合检查时存在另一任务的未提交PDD会话修复并运行1.0.59等待实店验收；为保留现场，本轮改用1.0.60独立验收并提供选择，未收到选择时不结束测试或覆盖改动。

完整清单、行数、退出码、失败原因和未验证项见 `artifacts/maintenance-round2/worker-summary.md`；证据统一存放 `artifacts/maintenance-round2/`。

## Task 5：用户授权整合 1.0.60 与主目录拼多多修复

用户现已明确要求保留双方改动并整合、复核验收后打开最新版，替代此前保留现场的等待状态。最终版本由 Codex 统一为 1.0.61。

- [x] 主目录 HEAD 1e041f1，PDD 工作副本 1.0.59；独立整理分支 b3ed1b6 / 1.0.60。已将主目录修复的补丁、原始文件和 SHA256 快照保存到 artifacts/integration-pdd-20261118/，不读取用户资料。
- [x] DeepSeek 在当前隔离工作树迁入快照中的 dom-text-adapter、两个 PDD 测试、platform-write-coordinator 测试、PDD hook 和对应来源/哈希记录；迁入时业务文件与快照逐字节一致，随后 dom-text-adapter 按页面基线修正更新。文档保留双方内容，忽略旧 package 版本差异，不引入视觉模型任务文档或其他源码。
- [x] 在组合源码运行 PDD 会话归属/面板身份/发送定位与逐字输入/确认、知识库控制器/待学反馈、同步与入口的直接相关测试，类型/变更静态、vendor 哈希与必要上游验证、构建和隔离原生检查。保留首次失败，不扩大语义修改或绕过审批。
- [ ] Codex 独立核对迁入文件、清理删除项和公开契约，复跑核心组合测试；独立 reviewer 复核 PDD 变更及发送门。需要修正时回到原 DeepSeek 会话。
- [ ] 主目录迁入前再次对照快照，保留本轮之外的未跟踪文档和并发改动；组合代码提交、推送 main 并核对精确 CI/产物。通过后只正常重启本项目，保留原 userData，实测进程与界面版本。

执行复用 Git 补丁/原文件快照、既有 Vue/TypeScript/Electron 工具与测试，不新增依赖、IPC、持久化或平台操作；真实买家发送与付费模型仍不属于自动验收范围。

### DeepSeek 实际结果（隔离树，未提交）

- 7 个授权文件按 artifacts/integration-pdd-20261118/files 原字节迁入，SHA256 全部匹配；platform-write-coordinator.test 保持快照逐字节一致；dom-text-adapter 初始一致，后续仅按页面基线修正更新。未改 package.json/package-lock，未引入视觉模型文档。
- 组合前复核新增两条 PDD 归属缺陷：未知角色 WS 帧提前占用 seen/水位导致晚到 buyer/seller 角色被吞；无 middlePanel ID 时单条公共文本放行整个旧面板。先补负向用例并在未修正 v11 上运行得到 2 文件 12 项中 4 项失败（退出 1，日志 vitest-pdd-red-v11.log）；hook 最小修正为 v12 后同 2 文件 12 项通过（退出 0，日志 vitest-pdd-green-v12.log）。随后补 `constructor`/`toString`/`__proto__` 继承属性用例，先在 v12 得 3 项失败，改用无原型字典后 6 项通过。
- 第三条“批准后新买家到达仍发送旧无欢迎正文”由实际 worker/审批/授权/协调器/adapter 组合离线复现：原 HEAD 发送门 1 项失败（旧正文 prepare=1，退出 1），在 electron/welcome-delay.ts 统一发送门绑定批准时会话指纹并保留到定位/输入/点击后，review-engine 9/9 通过；稳定无欢迎回复仍单次点击，不引入欢迎延迟。
- 缓存回归：真实 gate + 与 local-runtime 等价的 beginRead/welcomeCheckSnapshot 端口，连续两次无欢迎回复；未修正时第二条稳定回复误取消，1 failed / 4 passed（退出 1，vitest-welcome-cache-red.log）。每次批准前无条件新同步读取后 5/5 通过（exit 0）。
- 网页先到、归档未同步：真实组合 harness 只改 pageMessages；未修正 review-engine 1 failed / 9 passed（旧正文 prepare=1），adapter 4 failed / 11 passed（页面/指纹变化实际发出）。许可携带批准 `pageReview` 指纹，send 锁内 focus 后用原始 `_callHook('reviewHistory')` 核对；未知/uid/page/指纹变化均零 prepare/零点击。
- 异步取消与生产回调：typingInterval=50 的网页复核 await 期间停 AI 仍 prepare=1（red），改为整段/逐字共用 prepare 前 current/cancelRequested 后 adapter 17/17；页面安全拒绝从 `conversation_not_found` 改为合法 `hook_not_ready`+`throttled:true`，加入真实 `onDeliveryFailure` 的组合 red 显示 send_unconfirmed，修正后 review-engine 10/10、不触发 delivery failure/quality，同条入档可生成新候选。最终受影响 8 文件 67 项通过；未重跑 15 文件 156 项、242 上游或全部 knowledge 25 项。
- 组合定向 15 文件 156 项通过（maxWorkers/minWorkers=1，退出 0）。此前机械迁入后的长验证被 Codex 中止，日志 vitest-targeted-1.log 保留，不计为完成。
- typecheck、7 个自有 TS 文件 ESLint/Prettier、build、check-vendor（runtime 80 / server 94）退出 0；上游 242/242 通过。原生隔离 12/12（9 项 PDD DOM 填写/确认/发送、旧首页、紧凑监控、开发者控制台）；知识库主专项 18、待学问题 2、内嵌进度 5 项通过。
- 未运行全量 npm run check/test:desktop、真实平台/付费模型/真实买家发送；未 commit/push/重启。1.0.59 实店双买家验收仍未完成，不改成通过。package/lock 仍 1.0.60，1.0.61 由 Codex 定版。
