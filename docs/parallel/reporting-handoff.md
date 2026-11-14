# 日报、订单与售后统计交接（2026-11-14）

## 当前验收结论（16:34）

公共运行时已由统筹接入，并修复托管初始化后漏调度。统筹串行执行 `node scripts/reporting-isolated-check.mjs`，三个**独立真实 Electron 进程** A首次→B账号→A重启全部通过；已读实际产物 `artifacts/reporting-isolated/summary.json`、`a-first.json`、`b.json`、`a-restart.json`：

- 实际托管controller选择稳定账号目录，计数 A=1、B=2、A重启=1；A 首次与重启账本 SHA256 完全一致，验证不重复且B未改写A。
- 实际受沙箱保护的 preload 与 business IPC 返回报表DTO；每阶段均验证登出后 reporting=null。
- 原生运行时汇总导出与持久文件均不含测试买家UID/姓名/正文、访问及刷新凭据标记。组件实际导出按钮也有针对性脱敏测试。
- 合成售后快照明确当前待商家处理范围，stale不能展示完整合计；生产采集器固定“近3个月内”范围已写入DTO/UI。未打开或采集实店。
- 18项阶段检查及跨进程账本一致性断言通过。`osSandboxDisabledForCheck=false`；使用与锁定依赖 SHA256一致的系统 Electron 43.8.9，未降级生产安全配置。各阶段浏览器网络请求尝试0，无模型调用或买家发送。
- 最新领域定向测试4文件22项通过；Vue类型、Electron类型检查退出0。此处是实际隔离链路验收，不代表全量Release、实店完整日报、平台订单或营收接通。未提交/推送/发布。

以下为此前调查与交接过程，首轮环境阻断已由上述当前结果取代。

## 用户追加要求与公共接线待修复

用户在本窗口追加：继续配合统筹完成公共运行时接线和隔离桌面验收，重点是重启去重、账号隔离、售后范围标识及导出脱敏，不能停在领域模块完成。统筹已安排统一隔离真实 Electron 验证，本窗口不再并发启动专项进程，不重启用户桌面，不改公共装配。

**发现公共接线缺口（按当前源码静态核对）**：`local-runtime.ts` 的初始 `scheduleReporting()` 在 `managed.init()` 前调用；托管状态尚为 signed_out，所以直接返回。`managed.changed` 仅发 managed:changed，`start()` 在 `await managed.init()` 后未再次 scheduleReporting。因此已有托管归档在无后续业务/review事件时不会进入账本，可能显示持久化零值。建议统筹在 `await managed.init()` 后、可访问工作区时调用 `scheduleReporting()`，并在 managed.changed 的正常生命周期内调度（注意工厂初始化/变量就绪时序）；专项应验证无需操作店铺即可从归档恢复计数。

新增 `electron/reporting-isolated-check.ts`、`scripts/reporting-isolated-check.mjs` 为三独立进程 A首次→B账号→A重启的专项脚本，消费实际 createLocalRuntime/managed controller/native safeStorage/preload/IPC，合成账号响应直接注入，不联网、不打开平台。另测登出屏蔽、售后 stale→null、持久账本与导出秘密标记缺失。当前未通过：本机正常 Electron 启动即 0x80000003；仅专项 `--no-sandbox` 后可进入代码，但原生进程创建 runner 的系统临时子目录报 EPERM，未到业务断言。该参数只在测试 runner，未改生产保护；这不证明桌面链路通过。统筹已要求统一验收，本窗口停止并发原生重跑。`app.exit` string|number 类型已改为显式 Number。

runner 后续改为在 `artifacts/reporting-isolated/workspace-*` 建立临时隔离目录，避免原生进程对系统临时目录的 EPERM；清理前验证绝对父目录和固定前缀。默认不禁用 OS sandbox，只有测试调用方明确设置 `LINGTU_REPORTING_CHECK_NO_SANDBOX=1` 才使用专项降级，不作为生产安全验收。统筹串行执行：`node scripts/reporting-isolated-check.mjs`；必须有当前公共构建的 dist/index.html 与 dist-electron/preload.cjs。该 runner 只构建自身 dist-electron/reporting-isolated-check.cjs，不覆盖 main/preload/dist。三阶段都通过后生成 summary.json，比较 A 账本的 SHA256，证明 B 和跨进程重启均未改写 A 的事件证据。新增脚本 ESLint、Electron 类型检查已通过；工作区路径变更后的原生流程尚未重跑。

16:25 复核：统筹已在 managed.changed 和 managed.init 完成后补 `scheduleReporting()`。本领域四文件20项再次通过，Electron 类型通过。另只读 `icacls node_modules/electron/dist/electron.exe` 确认该exe继承 Low Mandatory Level (NW)，与启动前0x80000003及Temp写入EPERM有关联可能；已把证据同步统筹，未自行更改ACL。公开接线已存在，原生验收以统筹统一报告为准。

16:27 追加测试实际复现并修复：账号切换待重启时，主数字虽为 —，但模拟数量 small 仍显示上一工作区数字；ShopHomePanel 已先判断 !ready 并遮蔽该说明。新组件测试同时执行导出按钮，验证私有买家UID/姓名/正文均不进入下载JSON，且售后UI明确“非周期新增”；切账号禁用导出并隐藏旧模拟数字。导出 unavailable 现在在完整售后源已接入时不再矛盾地宣称售后未接入。新界面改动未自行build，统筹最终前端构建应纳入。

后续增量结果：四文件21项通过（新增导出与切账号组件回归）；新增“持久目录被文件阻断时不抛异常、不虚报保存、不计未保存事件”账本测试也通过，账本现在4项。改动文件 ESLint通过，Electron类型检查通过。等待统筹原生验收，不把这些测试当成真实桌面完成。

16:30 复核：此前 team-service 缺文件已由并行任务补齐，`npx vue-tsc --noEmit`、`npx tsc -p tsconfig.electron.json --noEmit` 及追加改动 ESLint 当前全部退出0。统筹公共构建/原生窗口已能运行，日报三进程专项仍交统筹串行执行。

售后查询范围再次核对：真实 `assist-platform-reader.ts:265` 标明“待商家处理售后（近3个月内）”。报表来源 DTO 现在增加兼容可选 queryWindow，拼多多为 last-3-months、其他平台unknown；看板显示“近3个月内待商家处理 · 非周期新增”，旧DTO没有范围则如实标为“查询时段未提供”。不把近3个月待办称作全历史待办。已通知统筹最终构建纳入；此后冻结领域源码，仅处理统一原生验收发现的问题。

## 实现与边界

实际源码根为 `E:/~1awucheng/Plastic SCM/AI电商客服软件/client`。不使用文档旧 F 盘路径；不修改公共装配、后台路由或公共 HANDOFF，不提交、推送、打包，不操作真实浏览器或买家。

- `electron/reporting-ledger.ts`：工作区内原子 JSON 事件账本，近30个本地日、最多20万事件；跨重启去重。只持久化 SHA256 指纹、事件类型、时间、是否模拟，不写客户正文、买家标识、订单号、店铺名。损坏文件保留原样，返回 persistence:error；触顶标记 truncated，complete 永远 false。
- `electron/reporting-pipeline.ts`：导出 `createReportingPipeline(dataDir, clock?)`，API 为 `observe(snapshot: BackendSnapshot): number` 与 `snapshot(platformItems?: PlatformItemsSnapshot): ReportingSnapshot`。消息、工单创建、已提交且已完成的正式 AI 请求、带送达诊断时间的确认发送分开统计；不把卖家消息全部算作 AI、不把压缩请求算作回复、不把候选时间当送达时间。
- `src/shared/contracts/reporting.ts`：Zod 契约和 `ReportingSnapshot`、`ReportingReport`、`ReportingKind`，纯跨层 DTO，不引入 IPC。
- `shops/dashboard.ts` 和 `ShopHomePanel.vue` 已消费 reporting 数据：周期确认发送、模拟独立数、生成/失败/工单数、保存失败和范围提示，以及售后实时来源状态。原快照消息计数保持原口径，不冒充持久事件统计。
- JSON 汇总导出包含事件数据质量与平台业务状态；默认不导出客户正文、名称、模型上下文或凭据。
- 平台订单接口缺失，订单数量与营收均为 null/unavailable。售后只消费现成 `assistCollector.snapshot()`，明确是“当前待商家处理”，不代表周期新增/退款成交。失败或不完整源 total=null；只有所有当前店铺均有完整成功源才显示汇总数字。

## 公共接入（由统筹修改）

1. `shared/contracts/backend.ts`：import `reportingSnapshotSchema`，在 snapshotSchema 新增 `reporting: reportingSnapshotSchema.nullable().default(null)`。旧快照默认 null，禁止默认空零报表冒充已启用。看板用 safeParse，可兼容 null/未接入。
2. `local-runtime.ts`：在 `const dataDir = managed.dataDir` 后创建 `const reporting = createReportingPipeline(dataDir)`。必须使用此账号隔离目录，不能使用随机 workspaceId 作文件哈希或存储目录。
3. 独立函数读取已经完整装配的快照：先构造 `{...read(), review: review.snapshot()}` 的 BackendSnapshot；只在 `managed.canAccessWorkspace()` 且非 closed 时执行 `reporting.observe(snapshot)`。工厂装配期间 backendRef/review 未就绪时不要触发。禁止在 read() 本身 observe，防止 review.sync/read 递归。
4. 启动已有记录准备完成后、业务 onEvent 及 review changed 回调后调度观察。推荐同一 tick 合并，避免每条日志重复扫描/写入。review changed 可能发生于工厂初始化期间，必须检查 backendRef.current；定时/退出如有待处理观察需安全清理，账号切换后不再写旧工作区。
5. 对可访问账号的最终 snapshot 附加 `reporting: reporting.snapshot(assistCollector.snapshot())`，不能把最终送往 renderer 的快照再 parse 成缺少 review 的版本。账号不可访问时 reporting=null；售后输入只用当前工作区的 collector，不主动刷新、不打开平台。
6. 公共 schema 接入后，现有 snapshot/execute IPC 会自动传递 DTO；无需新增通道、任意文件读取或 renderer 存储权限。

## 方案复用

优先复用项目 Zod 4.6.7 与已存在的主进程原子 JSON 写入结构（managed-controller/assist-window）。检索比较 [lowdb](https://github.com/typicode/lowdb)（MIT、轻量 JSON、仍维护）与 [electron-store](https://github.com/sindresorhus/electron-store)（MIT，官方说明适合小型设置、频繁大数据应选数据库）。本次为最多20万条脱敏事件，无新增依赖、无搬用第三方源码；后续高频长期报表应评估 SQLite 批量事务，不能把此有界账本称为完整平台数仓。

## 验证与验收

增量验证：`npx vitest run tests/dashboard.test.ts tests/dashboard-panel.test.ts tests/reporting-ledger.test.ts tests/reporting-pipeline.test.ts --maxWorkers=1 --minWorkers=1` 四文件20项通过；本任务改动源码/测试 ESLint 通过；`npx tsc -p tsconfig.electron.json --noEmit` 通过。`npx vue-tsc --noEmit` 被并行任务的 `tests/team-service.test.ts` 尚缺 team-service 模块及隐式类型错误阻断；本任务文件没有报告类型错误，不能声称全项目类型通过。

测试均使用临时目录/合成快照，未使用实店、付费模型或买家发送。待统筹完成公共接线后，应在隔离 Electron 工作区验证：事件进入→刷新看板→重启计数不重复；账号切换屏蔽旧报表；售后完整与失败状态；导出不含客户正文。尚未完成这些桌面链路验收，不能称为实店完整日报。售后汇总排除模拟店铺，并要求 storeId 与平台同时匹配，防止来源串店。
