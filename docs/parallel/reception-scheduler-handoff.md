# 接待自动化 / 调度集成请求（2026-11-14）

本任务只修改 reception、ScheduledTasksDialog 和新增 reception-automation-_ / scheduler-_ 文件，以及独立契约和测试；不修改已有 local-runtime/preload/desktop 公共文件。

需要公共装配负责人最终接线：

- 新增主进程 SchedulerRuntime（workspaceId + workspace 私有路径），生命周期 start/dispose 随工作区替换；通过 registerSchedulerIpc 验证 requireAppFrame。
- preload 合并 createSchedulerPreload() 的 schedulerSnapshot / schedulerExecute，DesktopApi 增加对应可选签名；不得暴露原始 ipcRenderer。
- 工作台通过提供的模块 service 使用桥接；缺接线明确不可用。
- 接待事件必须来自经验证的平台事件源；当前未验证无消息访客/订单未付款/客服名单，不得猜接口。媒体 hook 存在不等于已验证发送能力。
- 调度仅建立待批准事项，不发送。与统一确认门的媒体/无消息会话基线尚需公共运行时支持，不能放行或绕过 ReviewConsole。

本任务将提供独立交接、接口、定向测试。现有公共文件保持原样，避免覆盖并行变更。

## 公共接入最终签名

- `createFileScheduler({ workspaceId, directory, validateTask, capability? })` from `electron/scheduler-storage.ts`。`validateTask(task: SchedulerTaskInput): void` **必填**，在保存/启停及每次到期/事件核对当前工作区店铺与会话。`capability(task: SchedulerTask): string` 返回具体阻塞原因，缺省全部 blocked，只有已验证事件来源及确认门时才返回空。
- `registerSchedulerIpc({ requireAppFrame, resolveCurrent: () => current.scheduler })` from `electron/scheduler-ipc.ts`。返回注销函数，统一注册一次，退出时注销。snapshot 通道接收 **workspaceId 字符串**，严格匹配；execute 含 workspaceId，并在返回前复核实例。
- preload 合并 `...createSchedulerPreload((channel, ...args) => ipcRenderer.invoke(channel, ...args))`；DesktopApi 增加可选 `schedulerSnapshot(workspaceId: string): Promise<SchedulerSnapshot>` / `schedulerExecute(command: SchedulerCommand): Promise<SchedulerSnapshot>`。类型来自 `src/shared/contracts/scheduler.ts`。
- 实例 `start(): void` / `dispose(): void` / `snapshot(): SchedulerSnapshot` / `execute(input: unknown): SchedulerSnapshot`。随 workspace start/dispose，managed.dataDir 私有路径保存 `reception-scheduler.json`。关闭先取消 timer 与 pending；重启不恢复批准。UI 自动读取共享 runtime.snapshot.workspaceId，拒绝跨工作区迟到结果。
- `ReceptionAutomation` from `electron/reception-automation-runtime.ts` 接收 `{ scheduler, load, save, now? }`，提供 `saveRule(input)` / `setEnabled(id, enabled)` / `snapshot()` / `observe(platformEvent)`；observe **主进程专用，不加 IPC**。无真实来源时不启动虚构访客轮询。每条媒体独立意图，事件去重持久化24小时，上限10000满后拒绝生成。

确认挂接点：所有 run 是待提交确认意图，**无 approve/send/sent**。现有 ReviewConsole.propose 要求非空真实消息基线；无消息欢迎及媒体不能直接套用文字 gate，未扩展前 capability 不得返回空。将来普通文字接入须用当前 worker 的 `isCurrent/getHistory/getPageReview` 和统一门，不能直接 adapter.sendText。平台访客源、媒体门、未付款订单事实及实际客服名单均为后续真实接入阻碍，不能用hook存在代替能力验收。

## 本任务交付范围与验收（2026-11-14）

已实现：

- 调度 CRUD、启停、一次/每日 IANA 时区/分钟间隔；错过周期最多合并一次，不重放历史批量消息；每日夏令时重复小时只算一次，不存在时刻跳过。
- 原子落盘、重启保留任务和执行记录、取消旧未批准事项；workspace 校验、版本冲突保护、到期重新核对店铺/会话；任务修改/删除/停用取消关联事项。
- 访客/媒体/催付/客服转接的可信事件匹配与独立意图生成；访客须明确 messageCount=0，催付须订单仍未付款且订单号匹配，转接须目标在实际名单中；10分钟事件时效，24小时持久化语义去重。
- 任务对话框与模块服务已内部接好，使用原 MainLayout 的既有定时入口；工作区变更清除旧资料与编辑器，迟到读取/操作响应不覆盖新账号或操作结果；任务默认停用。
- 没有发送/批准函数、没有 sent 或伪造平台成功状态。pending 显示“待提交确认”，不是已有确认窗口中的已批准事项。

**必须保持的真实缺口**：

- ReceptionAutomation 事件规则类提供持久化工厂 `createFileReceptionAutomation({ directory, scheduler })`，但本轮没有规则UI、规则IPC，也未在公共运行时注册此工厂/真实平台事件源。用户当前不能配置无消息访客欢迎或自动媒体欢迎规则。不得称这些平台自动操作已全部完成。
- 当前已提供的任务UI可保存对应动作的定时意图；平台适配器/确认门未经验证的能力必须 blocked。已有 ReviewConsole 要求非空消息基线，媒体与无消息会话仍缺确认门扩展，不能绕过。
- 当前转接动作未真正转客服，催付未真正读取平台订单/发送，媒体未发送，未登录实店验收，未触发真实买家消息或付费模型调用。
- 未进行原生窗口/浏览器截图验收；弹窗用 Vue DOM 测试验证。未做全量 Release、打包、提交、推送或部署。

文件清单：

- 新增 electron/scheduler-runtime.ts、scheduler-storage.ts、scheduler-ipc.ts、scheduler-preload.ts。
- 新增 electron/reception-automation-runtime.ts、reception-automation-storage.ts。
- 新增 src/shared/contracts/scheduler.ts、src/modules/workbench/services/scheduler.ts。
- 修改 src/modules/workbench/components/ScheduledTasksDialog.vue、workbench/README.md、reception/README.md。
- 新增 tests/reception-scheduler.test.ts、reception-automation.test.ts、reception-scheduler-storage.test.ts、reception-scheduler-dialog.test.ts、reception-scheduler-ipc.test.ts。
- 本文件是本任务唯一交接，不改公共 HANDOFF/DECISIONS；公共 local-runtime/preload/desktop 等由统筹修改，不属于本任务的改动。

实际验证：

- `npx vitest run tests/reception-scheduler.test.ts tests/reception-automation.test.ts tests/reception-scheduler-storage.test.ts tests/reception-scheduler-dialog.test.ts tests/reception-scheduler-ipc.test.ts --maxWorkers=1 --minWorkers=1`：5文件24项通过。
- 覆盖容量零历史边界、满队列拒绝、事件跨实例令牌去重、旧轮询覆盖停用的时序回归、磁盘损坏不清空、工作区令牌与可信窗口校验。
- 独立代码审查发现的2项问题已修复并有回归测试。
- Electron 类型检查先前已通过一次；最后增量 ESLint/Vue/Electron 类型结果见下方补充。此前 Vue 类型发现其他并行模块错误，仅记录不修改他人文件。

成熟方案检索与复用：

- 已检索 https://github.com/node-cron/node-cron ：近期维护、TypeScript/Node兼容、当前许可证是 **ISC**（已核对 LICENSE.md，早前口头MIT记载错误）。https://github.com/node-cron/node-cron/blob/main/LICENSE.md 。其本身不持久化执行状态，不提供本产品确认门；引入它仍需全部业务队列与恢复逻辑，本次每日/一次/间隔三种固定语义不引入额外cron依赖。
- 复用本项目 Zod 校验、既有共享 runtime workspace 身份、既有桌面桥接边界和 Node fs/Intl；没有下载第三方代码、增加依赖或更改 vendor 许可与源码。

下一步验收：统筹完成公共生命周期/桥接后，在隔离临时工作区通过真实 Electron 打开定时任务，验证新增/启停/取消/重启；真实平台动作继续 blocked，直到有可验证事件源及逐条确认门适配。事件规则界面/公共注册另作为明确未完成项，不以本地夹具测试代替实店成功。

最终静态验证补充：上述本任务14个代码/测试文件的 ESLint 无错误；`npx vue-tsc --noEmit --pretty false` 与 `npx tsc -p tsconfig.electron.json --pretty false` 最后一轮均无输出、退出0。此前 tests/reception-scheduler-dialog 的 Promise<unknown> 类型已显式改为 Promise<SchedulerSnapshot>。这些为本轮直接影响的静态检查，不代表全量 Release 验证。
