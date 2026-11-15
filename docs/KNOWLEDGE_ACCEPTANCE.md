# 知识库隔离验收记录（2026-11-15）

范围：分支 `codex/knowledge-library-refactor-20261115`，Task5起点 `7d638e5`，实际main基线 `f2193fc`。统一SQLite、管理窗、采集/学习、日检/待学箱、兼容导出和全库/同款恢复均已实现；独立Task5 gate和全分支审查由统筹随后进行。本记录不宣称审查已通过或公开发布。

## 直接相关检查

- `npx.cmd vitest run tests/knowledge-backup.test.ts tests/knowledge-daily.test.ts tests/knowledge-runtime.test.ts tests/knowledge-repository.test.ts tests/knowledge-bridge.test.ts tests/knowledge-collector.test.ts tests/knowledge-imports.test.ts tests/knowledge-model-learning.test.ts tests/knowledge-manager.test.ts tests/knowledge-window.test.ts tests/workspace-runtime.test.ts tests/platform-learning-provider.test.ts tests/context-compression.test.ts`：18:15，12匹配文件、139/139通过，32.43秒。`knowledge-bridge.test.ts`不存在，因此未匹配；IPC证据实际来自window测试及原生组合，未计入虚构套件。
- `npx.cmd vitest run tests/knowledge-migration.test.ts tests/knowledge-sources.test.ts`：18:18，2文件12/12通过，4.16秒。
- 最后恢复一致性/历史范围补查：`npx.cmd vitest run tests/knowledge-backup.test.ts tests/workspace-runtime.test.ts`：18:23，2文件14/14通过，5.80秒。与主集合重叠，不相加当新增数量。
- `npx.cmd vue-tsc --noEmit`、`npx.cmd tsc -p tsconfig.electron.json --pretty false`、本次变更源码ESLint/Prettier、`git diff --check`均通过；`node scripts/check-boundaries.mjs`通过，`node scripts/check-vendor.mjs`核对80客户端和92服务端固定文件通过。
- `npm.cmd run build:desktop`构建生产main/preload成功；下述原生脚本各自构建真实Vite renderer，成功。未运行全量check、全量桌面/上游套件或Release打包。

## 原生组合证据

`node scripts/verify-knowledge-manager.mjs`：13项检查通过，4次loopback模型请求，`visibleWindows:false`；最终报告完成时间 `2026-11-15T10:19:21.497Z`。

实际验证包括受信IPC和SQLite卡片、两店上下文单窗口、草稿自动保存、审核后试问/既有训练请求、关闭保存并隐藏、旧JSON零写、实际模拟顾客worker→模型→审核、撤回后零发送。另用真实PDD适配器和隐藏离线HTML，验证撤回/过期/来源变化/本店覆盖在逐字输入中及最终点击前的8种情形，全部零点击；未操作用户窗口或真实买家。

1001根商品夹具每页20卡、延迟加载图片，offset980查询最终5毫秒。原生恢复从目录选择器到范围预览、实际关闭writer、同账号重建和窗口新租约；其他1000商品保留，AI按既有启动默认关闭。故障恢复另有workspace测试，保留恢复点、不改模型来源/发送模式。

`node scripts/verify-knowledge-ingestion.mjs`：7项检查通过，5次loopback模型请求，`visibleWindows:false`。覆盖真实PDF扫描栅格、DOCX图片、XLSX各sheet、CSV目标预览、显式估算/学习、真实模型图片输入、不确定HTTP调用不重放、归档日期范围、逐商品部分审核失败保留原文。

证据保留在本机 `artifacts/knowledge-manager-check/evidence` 和 `artifacts/knowledge-ingestion-check/evidence`，不作为源码资产提交。manager的 `report.json.completedAt` 对应最终成功运行；旧选择器超时的 `previous-failure-*.txt`是历史失败，不是最终状态。详细实现/RED→GREEN/契约报告在本地 `.superpowers/sdd/2026-11-15-knowledge-library/task-5-report.md`，由统筹审查后归档。

已实际打开检查 `final-1366.png`、`final-1920.png`、`final-900-logical.png`、`final-1366-150.png` 及恢复预览。最终列表先关闭审核结果弹层，toolbar正常换行，无横向溢出，页脚可见；1366×768在150%时列表视口较短，需要内部滚动。没有用覆盖基准图掩盖失败。

## 真实边界

- 全程合成数据/本机模型、独立临时账号；原有 `%APPDATA%/yunduo-ui-restored` 和其他dirty worktree未改、其他应用未重启，未恢复/删除用户资料。
- 新一轮实店PDD多页/CDN、真实云模型图片/语义质量未验证。用户原生控制仍Esc停止，没有SKY/CUA/Ego/可见窗口控制，也没有真实发送、付费模型、push/merge/publish。
- 罕见汉字9000字预算实测约21秒，复用tokenizer在worker计数，主线程继续响应，可取消/60秒超时；超限不调用模型，不静默裁剪问题或整条依据。
- Windows WSALookupServiceBegin10108、Rollup Zod注释和大chunk警告为已有基线告警。早期关闭窗口后曾拒绝晚到IPC，最终成功manager运行无此日志。
- GIF仅首帧；CSV/JSON导出为兼容文字、导回草稿。附件/历史/审核状态用完整或同款备份；同款备份可含跨商品完整原件和历史依赖，冲突拒绝覆盖。

实际开源项目版本/许可/链接/用途及当前功能见 [KNOWLEDGE_LIBRARY.md](KNOWLEDGE_LIBRARY.md)。没有引入新的第三方依赖或整体RAG框架。

## Task5审查修复第一轮（基线e1689e3）

仅修正恢复预览遗漏当前新增范围、已审核历史缺少审核记录仍获准恢复两项Important问题。预览现在对照备份和当前库，逐项显示恢复/停用保留历史/移除及实际店铺、商品、SKU和数量；全库当前独有的通用知识店铺也显示。计划绑定既有revision/fingerprint/token守卫。审核校验双向检查每个reviewed版本与有效审核记录，保留legacy-preserved兼容。

- RED：`npx.cmd vitest run tests/knowledge-runtime.test.ts tests/knowledge-backup.test.ts -t 'previews incoming|missing review audit|migrated legacy-preserved'`：18:35，4失败、1通过、20跳过。两类预览均缺T店；删除当前/历史审核记录且重算hash的备份均未拒绝。
- 同命令GREEN：18:36，5通过、20跳过。又补真实临时库恢复和旧token变更拒绝；全两文件运行曾有1项测试fixture错误（误替换独立迁移fixture中的stores，options未定义），修正后定点6项通过。
- 最终 `npx.cmd vitest run tests/knowledge-runtime.test.ts tests/knowledge-backup.test.ts`：18:39，**2文件25/25通过，25.72秒**。实际S备份后新增T根/SKU的family/full恢复结果与预览一致；全库U店无绑定通用资料计入影响，family保留无关U；缺审核记录在live文件变动前拒绝；真实legacy迁移备份仍可恢复。
- Electron TypeScript、这5个变更源码/测试文件ESLint、Prettier和diff空白检查通过。本轮未改Vue布局、未重跑native或全量检查；前述截图与原生组合仍是e1689e3证据，不冒充本轮新增验收。

M1知识历史选中项的显示归属留给统筹全分支审查；M2已有Windows/Rollup告警与实店/真实模型未验证边界不变。完整命令、失败输出和自审在本地Task5报告追加部分。
