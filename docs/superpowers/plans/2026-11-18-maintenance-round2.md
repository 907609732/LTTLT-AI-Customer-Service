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
- [ ] 更新 HANDOFF/VALIDATION 和本计划，统一 patch 后整合最新 main；不覆盖其他任务。
- [ ] 核对精确 CI 提交及标准产物；本次无公开发布。重开正常主目录实例，实测版本、可见窗口和原 userData。

## 实际结果

- Task 2：按 `deletion-candidates.json` 删除 63/63 项（19 个旧 demo、39 个共享图标、ShopPanelShell、shops/contracts.ts 与 GoodsRow 导出、sync 两个空转导文件、developer-debug/index.ts）；引用、模板、字符串入口和构建入口复核无外部消费者，仍使用中的资源保留。当前说明已按实际删除/职责更新，历史验收未改写。
- Task 3：新增 `product-family-controller.ts`、`miss-controller.ts`；manager 保留唯一草稿/审核/租约/client 守卫/销毁 owner。公开返回对象 126 项及顺序与 before 快照完全一致；manager 1463 → 1323 行，新控制器 192 + 76 行。
- 验证：6 文件 81 项在 `--no-file-parallelism` 重跑通过；删除领域 4 文件 27 项通过；typecheck、ESLint、Prettier、build、boundaries、diff-check 通过；知识主专项 18 项、misses 2 项、inline progress 5 项原生通过。首次 Vitest 临时 EBUSY 与独立 `--maxWorkers=1` 参数冲突的原始日志分别为 `vitest-first-ebusy-raw.log`、`vitest-maxWorkers-option-failure.log`；未改断言，serial 6 文件 81 项重跑通过。
- Codex 独立复核已完成：56 项独立测试、旧首页/监控/CMD 3 项原生检查通过，退出 0/completed 与产出已核对；后置 Knip 文件候选为空。版本、HANDOFF/VALIDATION、整合、CI 和重启仍 pending，由 Codex 完成。
- 未运行全量 check/desktop/upstream、未打包；未进行真实平台/付费模型/买家发送验收。

完整清单、行数、退出码、失败原因和未验证项见 `artifacts/maintenance-round2/worker-summary.md`；证据统一存放 `artifacts/maintenance-round2/`。
