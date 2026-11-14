# 跨店同步交接（2026-11-14，领域实现已完成）

实际项目根：`E:/~1awucheng/Plastic SCM/AI电商客服软件/client`。未修改任何公共装配文件，未修改 knowledge/reception/shops 组件，未提交、推送或部署。

## 给统筹的公共接入契约（可立即集成）

- 新增 `src/shared/contracts/store-sync.ts`；模块 `src/modules/sync/index.ts` 导出 `StoreSyncView`、`installStoreSyncClient` 以及同步类型。
- `createStoreSync({ directory, port })` 来自 `electron/store-sync-service.ts`。directory 必须为**当前活动账号 dataDir** 下 `store-sync-backups`，不要放在所有账号公用根目录。port 类型 `StoreSyncPort`：`snapshot(): BackendSnapshot`、`execute(command: BackendCommand): Promise<BackendResult>`、`assertActive(): void`。
- port.snapshot 用当前 runtime 的经过校验快照；port.execute 应直接调用当前 backend 的 execute 并 resultSchema.parse，**不要回调带同步锁的公开 runtime.execute**。port.assertActive 必须检查 `closed`、`managed.canAccessWorkspace()` 以及 `managed.state().restartRequired` 等当前既有账号访问门（按实际 managed 接口实现），不允许旧服务访问重启后账号。服务 `dispose()` 清除计划并使后续工作失败；runtime.dispose 时调用。
- 服务有 `isBusy(): boolean`。公开 runtime.execute 中必须在同步期间拒绝会影响复制的一切业务写命令（商品/接待/店铺删除/账号切换等）；直接 port.execute 绕过这个公开入口供同步内部使用。为安全可拒绝全部写命令，允许 refresh/list 等只读；更简单为同步期间拒绝全部 business.execute。避免外部命令在异步分页/回滚期间插入。同步内部同样逐项比较旧值，商品、欢迎、识图写入继续复用上游版本检查。
- `registerStoreSyncIpc({ ipcMain, authorize: requireAppFrame, resolveCurrent, changed })` 来自 `electron/store-sync-ipc.ts`，返回清理函数。`resolveCurrent(): { workspaceId: string; service: ReturnType<typeof createStoreSync> }`，**每次读取当前 runtime，不可固定捕获初始 service**。`changed` 可广播业务刷新事件，apply/rollback 无论成功与否都会调用。
- 四个 IPC：`store-sync:preview`、`store-sync:apply`、`store-sync:rollback`、`store-sync:backups`。全部接收 strict envelope `{ workspaceId: UUID, input?: unknown }`；服务端入参及异步返回前均重新核对当前工作区和 service。backups 不接受 input。
- preload 不开放任意通道；DesktopApi 增加对应四个窄方法，每个只 invoke 固定通道并接收上述 envelope。渲染端用 `createStoreSyncClient(invoke, getWorkspaceId)`（`src/shared/platform/store-sync.ts`）。invoke 由平台层 switch 到四个窄方法；getWorkspaceId 用 `() => runtime.snapshot.workspaceId`。client 也会检查晚到响应，app 装配 `installStoreSyncClient(client)`，卸载时调用其返回清理函数。
- 独立路由建议在 MainLayout children 添加 `path: 'store-sync', name: 'store-sync', component: () => import('@/modules/sync').then(m => m.StoreSyncView), meta: {title: '跨店同步'}`。不必修改原店铺/知识/接待组件；可先从菜单或 `#/store-sync` 访问。

## 已实现业务

选择单个源店、多个目标店（最多20个），明确选择商品编号（最多1000个），选择商品/文字欢迎/识图开关/本店人工关键词。预览新增、覆盖、跳过冲突、相同内容；单次最多2000个实际变更。商品按相同 productId 匹配，页面明确提示不同平台编号未必相同，没有自动猜测映射。

全局禁用词、超时兜底、全局关键词、模型凭据、意图知识、模型方案、买家历史和 AI 开关不复制。本店关键词的继承模式按当前工作区全局规则解释。不是平台商品写入或云端跨账号同步。

预览十分钟有效、一次性计划；应用前核对源/目标及当前工作区指纹。每项写入前刷盘 journal，失败报告部分完成及备份 ID，不声称全成功。回滚重启后可用，逐项检查同步后版本/值，不覆盖后续修改；先预检全部待恢复项，有已知冲突则不开始恢复。磁盘写入失败、崩溃可通过 writing/restoring intent 重建待处理状态。不会自动替用户回滚或发送任何消息。

## 限制和验收

- 上游转人工关键词没有版本号，只能比较当前内容；人工改后又恢复完全相同内容（ABA）无法识别。其余字段版本防护继续生效。
- 回滚恢复业务值，不回退版本计数、updatedAt、欢迎策略启用时间/已欢迎会话记录；不会重放欢迎消息。原来没有的默认欢迎/识图配置回滚为显式禁用默认值。
- journal 保存所选资料，只保存在当前账号本机工作区；不含 API Key/买家记录。不自动删除历史备份。损坏备份应报错，由用户恢复原文件，不吞掉错误伪造空列表。
- 尚未做真实店铺/平台验收，未向真实买家发送，未调用付费模型；只在临时目录用合成资料验证。公共装配由统筹完成后，还需要通过真实桌面路由和 preload 做一次隔离端到端验收。

## 成熟方案与选择

优先复用本项目已固定的 [PR18 后端](https://github.com/907609732/LTTLT-AI-Customer-Service/pull/18)：商品知识分页/保存/删除、欢迎策略、本店人工关键词、识图保存。许可为 AGPL-3.0-only，来源和固定提交以 vendor/lingtu-runtime/PROVENANCE.md 为准；未改 vendor 或引入依赖。Zod 沿用现有 4.6.7 运行时校验。

检索并检查了 [Starcounter-Jack/JSON-Patch](https://github.com/Starcounter-Jack/JSON-Patch)，MIT，TypeScript/Node 可用，提供 compare/applyPatch/test；npm 稳定版 3.1.1 发布较久，不能将其通用 JSON 变更当成本项目业务版本/店铺隔离/回滚协议。它不能复用已有领域校验，接入后仍须自写上述协调逻辑，因此没有新增该依赖，而是只实现薄协调器，业务存储仍完全复用现有服务。该取舍供统筹合并至公共 DECISIONS，未抢改公共文档。

## 文件清单

- `electron/store-sync-service.ts`：备份恢复协调器、计划、互斥、生命周期。
- `electron/store-sync-ipc.ts`：四个固定 IPC 注册/清理、可信页面及工作区校验。
- `src/shared/contracts/store-sync.ts`：strict 请求、workspace envelope、DTO 和客户端接口。
- `src/shared/platform/store-sync.ts`：窄 transport 适配与晚到结果隔离。
- `src/modules/sync/{index.ts,contracts.ts,README.md,services/client.ts,components/StoreSyncView.vue}`：领域内部完整接线及独立页面。
- `tests/store-sync{,-integration,-ipc,-view}.test.ts`：本领域增量测试。
- `docs/parallel/store-sync-handoff.md`：本交接。

## 实际验证与证据

- 运行 `npx vitest run tests/store-sync.test.ts tests/store-sync-integration.test.ts tests/store-sync-ipc.test.ts tests/store-sync-view.test.ts --maxWorkers=1 --minWorkers=1`，4文件19项全部通过（11项核心、3项Vue页面、4项IPC、1项真实上游存储集成）。包括真实 vendor backend 临时目录重启保存/回滚，四类资料隔离及旁店不变；没有平台适配器、真实买家或付费模型。
- `npx vue-tsc --noEmit -p artifacts/store-sync/tsconfig.json --pretty false`：针对本模块、两份主进程文件、共享契约/平台及上述测试的严格类型检查通过。配置只用于隔离验证，位于忽略的 artifacts，不替代项目正式 tsconfig，也不关闭严格检查。曾尝试项目 Vue 类型检查，检查当时被并行 scheduler-runtime receipts 契约未完成阻断；未修改该领域。
- 改动文件 ESLint 通过；仅格式化本任务新增文件。
- Ego 本地浏览器在隔离 Vite 页面上操作源/目标、商品编号、预览，确认执行按钮在未勾选时不可用；实际桌面视口2560与窄屏390均检测无横向溢出。证据 `artifacts/store-sync/browser-result.json`，独立 harness `preview.html` 全程明确“合成资料、禁止实际执行”。
- **截图验收未完成**：Ego Page.captureScreenshot 连续两次超时；未取得可检查图片，不能声称视觉截图验收通过。浏览器任务已关闭，统筹在公共路由接线后需补真实桌面截图/IPC端到端隔离验收。
- 未全量 check、未全量桌面测试、未打包、未发布。公共装配不在本任务修改范围，由统筹完成并验收。

- 补充增量架构检查：通过 checkSource 对本模块及新增共享契约/适配共6文件检查，依赖方向与组件环境 API 均通过。
