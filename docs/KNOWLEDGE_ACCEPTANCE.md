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

## 最终全分支审查修正（FIX_BASE `3c8a46e` → `2f962c1`）

最终审查发现I1–I4及M1后已完成一次集中修正，本节是 `2f962c1` 的源码/定向证据，等待统筹一次scoped rereview。十项实施取舍与代价已正式归档为 [KNOWLEDGE_DECISIONS.md](KNOWLEDGE_DECISIONS.md)。

- I1：301及4000字符问题完整保存；自动键使用完整原文JSON编码的SHA256。旧live中的已知超长自动键在同事务修复current/approved/全部history，审核和来源关系保持。manager→真实SQLite的保存、显式发布、重开编辑、全库/同款备份恢复均通过。已经生成的旧坏archive仍严格拒绝且原文件未改变；修复live后重新备份，不放宽schema。
- I2：实际manager任务按钮可继续 `needs-confirmation` 的collect/daily-check；submitted学习和cancelled任务没有bare resume。
- I3：A/B实际界面分别只显示共享知识及本店本商品/SKU覆盖；真实仓储保存范围再次校验，A不能保存B覆盖。B来源的共享依据可在A侧对照并查看来源历史，标明来源店铺；全家族绑定仍供影响预览。
- I4：在真实文件替换边界强制终止子进程，覆盖主库/WAL/SHM移走及新库就位四阶段；随后新owner在SQLite创建/迁移之前停止，现场所有文件内容哈希不变，原库、暂存库和恢复点保留。畸形/伪路径意图同样停止，不跟随标记路径操作。主入口专用用户提示受限于可信账号目录，明确完整复制及维护步骤。详见 [恢复中断维护步骤](KNOWLEDGE_LIBRARY.md#恢复中断维护步骤)。
- M1：选中、创建、放弃草稿清理历史；A→B→A期间旧session的迟到结果不会显示。

验证命令及结果：

- `npx.cmd vitest run tests/knowledge-manager.test.ts tests/knowledge-backup.test.ts tests/knowledge-repository.test.ts tests/knowledge-migration.test.ts tests/knowledge-restore-crash.test.ts tests/knowledge-restore-startup.test.ts tests/workspace-runtime.test.ts`：19:10，**7文件71/71通过，15.59秒**。第一次组合检查为70通过/1失败：旧自冲突测试fixture给product编辑器放了无所属绑定的条目；改成有效共享canonical fixture后，保留原A→B→A版本断言通过。
- 随后追加B店UI切换与旧坏archive只读拒绝断言，并补齐child fixture的LocalRuntime类型：`npx.cmd vitest run tests/knowledge-manager.test.ts tests/knowledge-backup.test.ts tests/knowledge-restore-crash.test.ts -t 'current product overrides|already-written|real process kill'`：19:12，**6通过、30跳过，6.18秒**，与前项重叠不相加。
- `npx.cmd vue-tsc --noEmit`、`npx.cmd tsc -p tsconfig.electron.json`通过。初次增量类型检查发现fixture缺少返回boolean的unsubscribe和openSimulatorPage，以及Node22类型未列出fork windowsHide；仅修正测试fixture契约并重新通过，未跳过类型。
- 14个变更TS/Vue/测试文件的ESLint、定向Prettier、`git diff --check`、`node scripts/check-boundaries.mjs`通过。初次ESLint的4个未使用解构变量已修正。
- `npm.cmd run build`源码Vite及desktop构建通过；仍有已知Zod注释和大chunk警告，不称无警告。本轮没有运行全量check、全量上游/桌面或Release打包。

全程合成临时目录、隐藏Node子进程，无用户应用或真实数据恢复。新界面证据是Vue交互测试，没有本轮新截图或真实Electron窗口验收；前文原生13项/7项及截图依旧属于 **`e1689e3`**，不提升为当前修正的原生验收。物理断电、Windows硬件缓存故障、实店PDD/CDN、真实模型语义/OCR、计费及安装包仍未验收。中断后选择fail-closed，须维护恢复；Windows仅文件flush、无Node目录fsync的限制已明示。

完整RED/GREEN输出摘要、自审及剩余边界见本机 `.superpowers/sdd/2026-11-15-knowledge-library/final-fix-report.md`。下一项是统筹针对本次差异的一次复审，验收条件为I1–I4/M1关闭且上述外部边界保留；不含推送、合并、公开发布。
