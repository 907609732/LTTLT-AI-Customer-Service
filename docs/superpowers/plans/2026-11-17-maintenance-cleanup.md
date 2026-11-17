# 2026-11-17 维护性清理与职责拆分（已完成，1.0.56）

基线 `44b269b`，分支 `codex/maintenance-cleanup-20261117`，工作树 `E:/codex-builds/lingtu-maintenance-cleanup-20261117`。最终版本 1.0.56；原计划的 1.0.54 已被主线 1.0.55 自定义模型 API 合入取代，该功能与本批清理/拆分并存，不覆盖、不移除。

执行方式：清理与知识控制器拆分由本机 DeepSeek 在本工作树完成；electron 运行时装配拆分由另一本机 DeepSeek 在独立工作树完成。两者均由 Codex 独立验证、只读审查并整合提交（清理 `206df4e`、知识 `ecbed7f`、运行时装配 `3070e00`）；公开 Release 与前序版本记录保持原样。

## 原则

- 先复核引用，再删除；未核实的页面、样式和服务保守保留并登记，不扩大清理范围。
- 复用现有 Vue 3.5.11（MIT）的 `ref`/`computed`/`script setup` 组合式写法、生命周期与模块服务，不新增依赖、不改公开接口和数据结构。Vue 组合式约定参考官方文档 <https://vuejs.org/guide/reusability/composables.html>；MIT 许可的 VueUse 仅作“按领域拆分组合式函数”的结构参考，不复制其实现，也不安装。
- Knip 已调研：对 Vue 组件导出、路由动态入口与 barrel 会误报，本轮不安装、不自动 `--fix`，人工复核引用后再删除。
- 旧页面只保留兼容跳转，不保留假数据组件；历史交接文档只加历史状态标记，不改写历史验收结论。

## 已完成

### 1. 清理与现行文档

- 删除无消费者的 `settings/demo/SettingsView.ts`、`shops/demo/ShopGoodsPanel.ts`。
- 删除仅 barrel 导出的 `GoodsListPanel`、`ShopDeskPanel`、`ShopSyncConfigDialog` 组件及 demo/导出；真实商品页使用 `ShopGoodsPanel`。
- 删除无菜单入口的 `ShopWipPanel`、demo、公开导出及 `learn/supervise/drill` 注册；真实训练/学习入口 `training`、`intent-doc`、`intent-chat` 保留。
- `/shop/home` 改为兼容跳转 `/shop/manage?panel=home`，删除旧 `ShopHomeView` 及其 `data-v-8a50ace1` 独占样式；smoke 改为断言落到数据看板面板。
- 移除 `main.ts` 无消费者的同步前端安装器与 `sync/services/client.ts`；保留共享契约、platform 适配、preload/主进程 IPC、同步/备份/回滚服务及测试，`sync/index.ts` 只保留契约 reexport。
- 文档同步共用本机 `local-runtime` 目录/`yunduo-local` 分区、切账号停 AI 且需重启、按平台身份恢复每店 AI、默认审核与按店显式自动发送；旧同步/知识导航交接加历史状态。
- 边界检查增强：`scripts/check-boundaries.mjs` 用现有 TypeScript AST 覆盖动态 `import()`、`window.fetch`/`globalThis.fetch` 与 Vue 普通 `<script>`，先加失败用例再修正；补 `checkVueSource` 声明。

### 2. 知识控制器拆分（`ecbed7f`）

`manager-controller.ts` 保留草稿/审核生命周期、跨视图协调、租约与工作区上下文交接；新增三个窄 controller：

- `catalog-controller.ts`：目录读取/筛选/选择/缩略图/采集提交；翻页保持 `identityVersion`+`scopeToken` 一致，未知总数不全选，缩略图两次异步读取后复核 scope。
- `maintenance-controller.ts`：备份、恢复预览/恢复、清空预览/清空；自持预览与 restoreLease，恢复前完整比较 workspace/store/revision/contextRevision；恢复/清空成功后替换工作区，故意使用未套旧租约 guard 的 `createKnowledgeClient`，由 owner 应用新 context。
- `product-learning-controller.ts`：商品学习范围、估算、启动学习、识图、本店通用资料学习；编辑器状态仍由 manager 持有。

`useKnowledgeManager()` 返回对象、顺序、页面布局/交互/文案不变；Codex 用 TS AST 核对 126 项返回键且顺序一致。

### 3. 主进程知识/辅助装配拆分（独立工作树，`3070e00`）

- `electron/runtime/knowledge-pipeline-assembly.ts`：组装 collector/daily/image-ocr/source-pipeline/coordinator 并向已注册 knowledge runtime 提供实时端口。
- `electron/runtime/knowledge-learning-assembly.ts`：组装草稿写入、collected-products 与 platform learning service；共享 provider 仍由组合根创建和销毁。
- `electron/runtime/assist-runtime.ts`：辅助中心平台页、读取器与采集快照；仅成功发布快照中的行可解析详情入口。
- `electron/runtime/assist-detail-catalog.ts`：有界保存已观察/已发布详情 URL，未发布前不向渲染层暴露。

`local-runtime.ts`/workspace runtime 仍是唯一组合根：创建顺序、账号/店铺租约、AI/发送审批、维护替换与资源关闭顺序不变；1.0.55 的 `list-custom-models` 命令继续走原 `local-runtime → electron/list-custom-models.ts`。

## 保留与未拆分

- 待学反馈 `updateMissDisposition` 与视图、状态筛选、分页、`refresh` 和租约竞争强耦合，抽离需要传递大量可变状态并复制 listing 作用域判断，边界不够清楚，保留在 manager。
- `manager-controller.ts` 仍未完全小型化；未按行数指标强行拆散 `leaseRevision`、`draftSession`、`editGeneration`、`saveTail`、`ticket` 等各自保护不同竞态的核心。
- 保留现有 demo 组件、共享 legacy CSS、同步服务/契约/IPC/备份回滚与测试；未核实的页面不扩大清理。

## 验证

- 第一批：3 文件 15 项、typecheck、build:desktop、边界检查、diff 检查通过；旧 `/shop/home` 原生 1/1 通过，截图 `artifacts/desktop-selected-1794931660094/shop-home.png` 已目视核对。
- 第二批：知识 6 文件 72 项通过；拆分前基线 6 文件 80 项只作改前证据，不叠加为最终回归项数。
- 第三批：运行时 17 文件 142 项通过，新增 factory 测试覆盖注册、惰性、限速、详情发布。
- 分阶段合计 26 文件 229 项，不称为整合后全量通过；两处独立只读审查未发现新 P1/P2。未运行全量 check/桌面/上游套件，未使用真实店铺或付费模型。

## 完成记录

- 2026-11-18：三批完成并整合；版本 1.0.56。整合登录/导航 31 项、类型、构建、变更静态检查通过；原生桌面 15 项及知识库主专项/待学问题/内嵌进度分别 18/2/5 项通过。仅修正原生待学验收脚本的 loading 时序等待，未改业务；首次失败及复验见 VALIDATION。最终主目录重启、GitHub CI 与下载产物仍待完成。
