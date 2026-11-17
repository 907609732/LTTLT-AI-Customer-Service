# 2026-11-17 维护性清理与拆分计划

基线 `44b269b`，分支 `codex/maintenance-cleanup-20261117`，工作树 `E:/codex-builds/lingtu-maintenance-cleanup-20261117`。只修改本工作树；不 commit/push、不重启、不升版本（总交付时统一升到 1.0.54）。顺序与验收由用户预先审查；Codex 负责验收。

## 原则

- 先复核引用，再删除；未核实的页面、样式和服务保守保留并登记，不扩大清理范围。
- 复用现有 Vue 3.5.11（MIT）的 `ref`/`computed`/`script setup` 组合式写法、生命周期与模块服务，不新增依赖、不改公开接口和数据结构。Vue 组合式约定的参考为官方文档 <https://vuejs.org/guide/reusability/composables.html>；MIT 许可的 VueUse 仅作为“按领域拆分组合式函数”的结构参考，不复制其实现，也不安装。
- Knip 已调研：对 Vue 组件导出、路由动态入口与 barrel 会误报，本轮不安装、不自动 `--fix`，人工复核引用后再删除。
- 删除的旧页面只保留兼容跳转，不保留假数据组件；历史交接文档只加历史状态标记，不改写历史验收结论。

## 第 1 批（本批，执行中）

1. **计划与文档**：本文件；统一现行行为描述。
2. **删除确认废弃的界面与 demo**：
   - `src/modules/settings/demo/SettingsView.ts`（无消费者）
   - `src/modules/shops/demo/ShopGoodsPanel.ts`（无消费者）
   - `src/modules/shops/components/{GoodsListPanel,ShopDeskPanel,ShopSyncConfigDialog}.vue` 及对应 demo、`shops/index.ts` 导出
   - `src/modules/quality/components/ShopWipPanel.vue`、`quality/demo/ShopWipPanel.ts`、`quality/index.ts` 导出、`navigation.ts` 的 `learn/supervise/drill`
3. **`/shop/home` 兼容跳转**：路由改为 `redirect: '/shop/manage?panel=home'`，删除 `ShopHomeView.vue` 导出与组件；其独占的 `src/styles/legacy/ShopHomeView-DfYeFwsG.css` 仅以 `data-v-8a50ace1` 选择器命中该组件，可随组件删除并移除 `styles/index.css` 导入；更新 `electron/smoke.ts` 对应检查为“旧地址落到数据看板面板”。
4. **移除无消费者的同步前端装配**：`main.ts` 删除 `installStoreSyncClient` 安装、`createStoreSyncClient` 导入与卸载调用；删除 `src/modules/sync/services/client.ts`，`sync/index.ts` 只保留共享契约 reexport。保留 `shared/platform/store-sync.ts`、`shared/contracts/store-sync.ts`、preload/主进程 IPC、同步/备份/回滚服务及其测试。
5. **文档现行化**：`README.md`、`docs/LOCAL_INTEGRATION.md`、`docs/ARCHITECTURE.md`、`docs/MANAGED_SERVICE.md`、`docs/AI_STATE_RESTORE.md`、`AGENTS.md` 修正共用本机业务目录/`yunduo-local` 分区、切账号停 AI 且需重启、按验证恢复每店 AI、旧批准不恢复；发送规则按“默认审核、按店显式自动”描述。`docs/parallel/store-sync-handoff.md` 等加历史状态与当前入口。模块 README 更新已删组件列表。
6. **边界检查增强（本批已完成）**：`scripts/check-boundaries.mjs` 用现有 TypeScript AST 覆盖动态 `import()`、`window.fetch`/`globalThis.fetch` 和 Vue 普通 `<script>`；先在 `tests/boundaries.test.ts` 增加会失败的真实规则用例（3 项 RED）再修正为 GREEN。补充 `scripts/check-boundaries.d.mts` 声明。不新增工具、不放宽平台适配器权限。

### 验收（第 1 批）

- [x] 基线三文件（`configuration-navigation`、`boundaries`、`policy`）先记录实际结果：10 项通过
- [x] 新增旧 `/shop/home` 兼容跳转与删除 `learn/supervise/drill` 后的回退测试
- [x] 重跑上述 3 个测试文件（15 项）及受直接影响测试（6 文件 77 项）
- [x] `npm run typecheck`、`node scripts/check-boundaries.mjs`
- [x] 变更文件 ESLint、Prettier
- [x] 不执行全量 `npm run check`、`test:desktop`、`test:upstream`；不升版本（版本仍 1.0.53，最终交付升 1.0.54）

## 第 2 批（待执行）：拆分 local-runtime

- 目标：把 `electron/local-runtime.ts` 的装配职责按现有生命周期拆成可测试单元（工作区工厂、平台/同步/调度、知识运行时），保持公开命令、数据目录和 IPC 契约不变。
- 前置：第 1 批删除完成并验收；先补装配级回归，再移动代码。
- 验收：现有命令快照与直接相关测试、类型检查、边界检查通过；不改变真实数据与发送门。

## 第 3 批（待执行）：拆分知识控制器

- 目标：拆分知识库控制器的采集/审核/检索职责，沿用现有仓储、Zod 契约和工作区租约。
- 前置：第 2 批验收通过；先界定公开接口再移动实现。
- 验收：知识专项测试、类型检查、边界检查；真实店铺与付费模型不在自动验收范围。

## 完成记录

- 2026-11-17：第 1 批执行。基线定向测试 3 文件 10 项通过；修改后同 3 文件 15 项通过；直接受影响 6 文件 77 项通过（单 worker；首次并发运行遇到 Windows 临时文件 EBUSY，未计入通过）。`npm run typecheck` 通过，`node scripts/check-boundaries.mjs` 通过，变更文件 ESLint/Prettier 通过，`vite build` 通过。未运行全量 check/desktop/upstream，未升版本、未重启、未提交。
