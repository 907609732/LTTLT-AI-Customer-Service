# AI训练场迁入知识库（2026-11-19）

## 设计范围

- 配置中心侧栏与 `panelRegistry` 删除 `training`；`?panel=training/sim` 仅保留兼容处理：先回到店铺列表，再用当前店铺打开知识库训练 tab。
- `KnowledgeManagerView` 在“商品”右侧增加“AI训练场”tab，复用 `ShopTrainingPanel`。训练固定使用知识库当前 `storeId`，不读取工作台 `runtime.selectedStoreId`。
- `ShopTrainingPanel` 不再显示店铺选择或手输 productId。商品下拉由知识库现有 `products` 查询按 100 条逐页读全后生成，显示“名称 · 编号”，支持名称/编号筛选。
- `KnowledgeProductCards` 操作区增加“AI训练场”；点击只切换到训练 tab 并预选本行 `binding.storeId/productId`，不调用 `start-training`。只有用户输入问题并点击“发送测试”才请求模型。
- 知识库窗口上下文新增 `tab/productId`，`openKnowledgeManager(storeId, { tab: 'training' })` 供店铺设置助手、图片识别和旧 URL 打开同一 tab。
- 切店/切商品时清空问题、模拟历史、图片地址和旧错误；请求带店铺/商品/代次租约，迟到回复或迟到错误不落入新上下文。商品分页读取也有独立 ticket 与 store 租约，旧店铺迟到列表不覆盖新店铺。
- 保留图片地址测试、错误提示、清空模拟对话；未新增依赖、持久化格式、发送能力或真实模型调用。

## 交互与 UI 核对

- tab 顺序为“商品 / AI训练场 / 通用问答”，训练 tab 隐藏商品搜索、批量选择、工具栏和分页，避免误把训练选项当知识列表。
- 训练区显示当前知识库店铺名、“已选商品：名称 · 编号”、商品筛选与下拉、全部商品数量；商品加载失败可重试。
- 商品行按钮位于“编辑”和“解除关联”之间，原有开始学习、图片识别、同款备份、编辑、解除关联保持。
- `ShopSetupGuide` 的“AI训练场”和 `ShopOpsPanel` 的“到知识库训练场测试识图”直接打开知识库训练 tab；旧模拟客服台/训练场 URL 不再渲染旧面板。

## 实施

- 共享上下文：`knowledge-client.ts`、`knowledge-window.ts`、`manager-service.ts`。
- 知识库：`KnowledgeManagerView.vue`、`manager-controller.ts`、`KnowledgeProductCards.vue`、`ShopTrainingPanel.vue`。
- 入口迁移：`navigation.ts`、`ShopManageView.vue`、`ShopOpsPanel.vue`、`ShopSetupGuide.vue`。
- 测试：`knowledge-training.test.ts`（新增 7 项）、`training-legacy-route.test.ts`（新增 2 项），并更新导航、窗口上下文、店铺设置与图片识别入口断言。
- 版本：开工时主树为 1.0.68，本 worktree 仅本批递增到 1.0.69，`package-lock.json` 同步。任务进行中主树被其他任务推进到 1.0.69（`be1755c`，00:37:27），随后合并到 1.0.70（`accbcc3`，00:42:53）；本分支按用户指定保留 1.0.69，但现低于主树，直接整合会回退版本，须由整合方决定再升 patch 或重放版本，不自行覆盖主树。

## RED

先写失败测试并执行：

`npx vitest run tests/knowledge-training.test.ts tests/configuration-navigation.test.ts tests/training-legacy-route.test.ts tests/shop-setup.test.ts tests/knowledge-window.test.ts`

结果 exit 1：5 个文件、13 项失败 / 12 项通过。失败覆盖旧侧栏仍显示训练场、旧 `training/sim` 未兼容、无训练 tab、无商品行入口、无分页商品、无预选、迟到回复/错误污染、旧上下文拒绝未知 `tab/productId`、店铺设置仍走旧 panel。

## GREEN 与验证

- `npx vitest run tests/knowledge-training.test.ts`：1 文件 7/7 通过，覆盖 tab 顺序与分页商品、名称/编号筛选、商品行预选、外部上下文预选、跨店迟到回复、跨店商品列表竞态、切商品上下文隔离、图片/错误/清空历史。
- `npx vitest run tests/configuration-navigation.test.ts tests/training-legacy-route.test.ts tests/shop-setup.test.ts tests/knowledge-window.test.ts tests/knowledge-manager.test.ts tests/knowledge-miss-feedback.test.ts tests/shop-ops-panel.test.ts tests/shop-ops-welcome.test.ts tests/shop-ops-welcome-receipt.test.ts tests/shop-setup-wizard.test.ts tests/shop-setup-reuse-wizard.test.ts`：11 文件 131/131 通过。
- `npm run typecheck`：exit 0。
- 改动文件 ESLint：exit 0；改动文件 Prettier check：通过。
- `npm run build`：exit 0；仅有既有依赖注释与 chunk 大小警告。
- 未运行全量 `npm run check`、`npm run test:desktop`、打包、真实店铺/模型或买家数据；未提交、未推送、未部署。

验证注意：一次把新增知识库训练文件与上述 11 文件合并执行的命令遇到 Vitest 临时目录 `EBUSY`（unhandled error，exit 1，未进入测试断言），随后拆分为上述两条命令均 exit 0；该现象按工具/临时目录问题记录，不冒充实测通过。

## HANDOFF

- 完成：训练 tab、分页商品选择、商品行预选、知识库店铺隔离、旧入口/URL 兼容、版本 1.0.69。
- 未完成/边界：未做真实桌面视觉截图与真实店铺训练；未新增付费模型请求；未验证真实平台商品目录内容。下一步可在独立桌面验收中核对 tab 滚动、商品搜索和成功/失败回复展示。
- 验收条件：知识库商品 tab 右侧出现 AI训练场；切店后店铺名/商品/历史一致切换；商品行打开时自动选中；只有发送测试产生 `start-training`。

## VALIDATION

- 实际命令与结果见上；证据回执在 `artifacts/training-migration/worker-report.md`。
- 本次只验证训练入口迁移和直接受影响的导航/知识库/店铺设置测试，不代表全量回归或真实业务验收。
