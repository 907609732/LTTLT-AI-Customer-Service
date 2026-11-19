# 知识库批量学习增量（2026-11-19）

## 范围

本增量只整理商品列表的“学习选中商品”流程，不改单件学习、OCR、学习整个店铺、发布/审核门、IPC、vendor 或服务端。批次固定为点击时当前知识库店铺、当前搜索/筛选内的精确选中集合；有选择后才显示操作栏。

## 语义

- 商品复选框始终可用；选中后操作栏显示全选本页、全选当前筛选（含跨页）、全不选、学习选中的 N 件商品和审核所选草稿。未选择时不常驻操作栏，保留原界面。
- `learnSelected` 按当前筛选逐页读取，按 binding id 去重并核对选中总数；列表 revision、搜索、视图、店铺/工作区租约或选中集合变化时拒绝使用迟到结果。
- 批量 `estimate` 汇总每个选中 binding 的详情报文，只保留未移除且属于当前店当前商品（含原单件语义的同商品绑定）的来源；来源按 id 去重，不加入未选商品、移除来源或外店来源。
- 单件“开始学习”仍只使用该商品及其来源；批量不会复用或覆盖单件选择。批量只准备估算，用户看到现有确认对话框并明确确认后才可启动真实学习；批量准备本身不请求付费模型、不发布知识、不自动确认任务。
- 失败、取消和不确定结果沿用原 pipeline/审核流程；不自动重试真实任务。

## 验证边界

- 目标 Vitest 使用纯 mock/jsdom，不启动 Electron、不访问真实平台/模型/账号/资料。
- `electron/knowledge-manager-check.ts` 和 `scripts/verify-knowledge-manager.mjs` 仅静态同步，本批未运行；需要原生验收时另行隔离执行。
- 执行阶段未执行 build、desktop、package、真实平台或实店验收，未改版本、AGENTS 和正式数据；版本仅由主线整合统一递增。

## 主线复核与交付

- 本机 DeepSeek 官方 session `session-9f7c6471-7170-4d3e-9ee3-e1428f1f3f5a` 正常完成，exit 0；原稿 checkpoint `8c75b86`，整理提交 `334d558`，主线合并保留远端 `c9147f4` 的 README 更新。
- Codex 核对实际差异、两处有效 RED 回归和最终 GREEN 日志；独立只读审查未发现阻塞合并的 P1/P2 问题。
- `tests/knowledge-manager.test.ts`（56）与 `tests/knowledge-batch-learning.test.ts`（3）共 59/59 通过；changed ESLint、Prettier、模块边界、`vue-tsc --noEmit` 与 `tsc -p config/tsconfig.electron.json --noEmit` 均通过。直接复用同代码状态的证据，没有重复全量验证。
- 合入后核对八个实现/测试文件与已验收提交逐字节一致，版本在 package.json 与 package-lock.json 根/包信息统一为 1.0.78；无依赖变化。原始八文件备份、哈希与补丁保留在主目录 `artifacts/knowledge-batch-integration-20261119/`，两份无关 AGENTS 修改保持原样。
- 本批没有构建、打包、自动打开或重启软件，没有真实模型、平台、付款、买家发送、发布或资料修改；提交使用 `[skip ci]`，防止本次源码推送触发打包。公开安装包仍为 v1.0.74。
- 未解决问题：未发现本批阻塞缺陷，但原生 UI、真实模型及实店行为未验收。后续用户允许启动时，在隔离资料中检查选择/跨页/估算/取消，再按明确授权验证真实学习；本轮不执行这些操作。
