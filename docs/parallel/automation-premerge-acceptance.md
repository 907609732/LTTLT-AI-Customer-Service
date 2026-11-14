# 自动接待合并前验收（2026-11-14）

核对源码根：`E:\~1awucheng\Plastic SCM\AI电商客服软件\client`。本轮只读源码/已有证据，运行现有单 worker 测试，仅新增本文档；没有修改公共代码、增加功能、构建、覆盖 dist、重启主程序、调用付费模型或触发真实买家/订单/客服动作。

## 状态口径与结论

- **passed**：明确列出的本地机制或隔离流程实际通过；不等同于平台真实业务成功。
- **not-connected**：存在类型/领域实现或界面字段，但生产调用链、产品配置入口或事件采集源未接通。
- **blocked**：当前生产运行时明确拒绝进入执行，或到期写入阻塞记录；这是防护行为通过，绝不是实际动作完成。

四项自动接待的端到端业务验收均为 **not-connected**；经现有定时任务入口保存的对应意图在生产 capability 下为 **blocked**。不能将四项标为真实平台验收 passed，也不能据本报告宣称原需求全部完成。

| 项目               | 真实事件源                                                                                                                   | 规则产品入口                                                                                                              | 统一批准门/真实动作                                                                                                          | 本轮结论                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 无消息访客文字欢迎 | **not-connected**：没有生产访客采集器调用 ReceptionAutomation.observe；visitor/messageCount=0/sessionId 目前只是领域输入契约 | **not-connected**：现有接待页保存的是“新会话首次 AI 正文附加文字”，不是无消息访客规则；规则无UI/IPC/运行时注册            | **not-connected**：事件队列未调用 ReviewConsole.propose，未适配空会话基线；定时意图为 **blocked**                            | 仅合成事件匹配/去重/时效测试 **passed**；真实欢迎未验收                   |
| 图片/视频欢迎      | **not-connected**：没有真实访客源或自动媒体欢迎生产调用链                                                                    | **not-connected**：定时弹窗可录入HTTPS媒体地址，但不构成访客欢迎规则；旧 WelcomeSettings 参考组件不是已接通的业务配置入口 | **not-connected**：SendProposal 为文字契约，没有媒体逐条批准与发送挂接；适配器媒体hook存在不等于接通；定时意图为 **blocked** | 图片合成意图生成 **passed**；视频实际发送、上传及平台接受度未验收         |
| 催付               | **not-connected**：没有已接入的真实未付款订单事件采集；领域只校验传入 status=unpaid 和匹配订单号                             | **not-connected**：定时弹窗可填订单号/话术，但无事件规则产品配置与事实核验流程                                            | **not-connected**：未接订单重核验、确认门和平台发送；定时意图为 **blocked**                                                  | 夹具中已付款拒绝、匹配未付款订单生成意图 **passed**；未读取或催付真实订单 |
| 平台客服转接       | **not-connected**：没有真实客服名单/转接请求采集器                                                                           | **not-connected**：现有转人工配置是关键词标记并暂停本会话AI；定时填客服编号不等于真实客服选择或转接规则                   | **not-connected**：未接平台转接命令及逐条批准；定时意图为 **blocked**                                                        | 合成名单中不存在目标时不生成意图 **passed**；没有真实转接成功证据         |

## 已核对的生产源码证据

1. `electron/local-runtime.ts:384-413` 创建了文件调度器，保存及执行时核对当前店铺和已采集会话；capability 在工作区、店铺、会话有效后仍无条件返回“平台事件与统一发送确认尚未验证；任务未发送”。因此这些动作不会生成可执行授权。该会话存在校验也意味着真正尚未采集成会话的无消息访客目前不能从任务编辑器绕过限制。
2. `electron/local-runtime.ts:329-334` 的既有普通AI回复 `beforeSend` 调用 `review.propose(proposal)`，证明原批准门存在；但不证明自动接待已挂接。`electron/review-console.ts:24-36` 的 SendProposal 是正文/会话/历史/网页基线契约；`electron/conversation-review.ts:17` 起的页面指纹对未知或空消息序列不提供有效指纹。本轮未发现事件意图到该门的调用链，不能直接复用门的存在声称无消息或媒体流程已验收。
3. `electron/reception-automation-runtime.ts:50-113` 提供规则保存/启停/observe匹配，只调用 scheduler.enqueueEvent。生产 `electron/` 与 `src/` 搜索 `ReceptionAutomation`、`createFileReceptionAutomation`、`enqueueEvent`，仅发现领域类、工厂定义及领域内部调用，没有生产实例注册、真实事件订阅者或产品入口。
4. `electron/reception-automation-storage.ts:5-10` 提供 `reception-rules.json` 工厂，但未被生产运行时调用。不能把“持久化工厂存在”写成“用户规则已持久化接入”。
5. `electron/scheduler-runtime.ts:124` 起的 enqueueEvent 与 `:230` 起的 tick 仅持久化 pending/blocked 意图；没有 approve、adapter发送或提交 ReviewConsole 的接口。pending 的含义是“待提交统一确认门”，不是“正在确认”或“已批准”。
6. `src/modules/reception/components/ShopOpsPanel.vue` 当前欢迎页面明确提示无消息访客及媒体未接入；转人工页面明确平台客服之间自动转接未接入，催付也明确未接入。这里的文字欢迎与人工关键词配置是其他已存在能力，不应计入本次四项端到端业务 passed。
7. `src/app/layouts/MainLayout.vue:290,298` 的定时任务入口已打开 ScheduledTasksDialog；`src/modules/workbench/components/ScheduledTasksDialog.vue:188-195,215` 包含媒体/转接/催付类型和“待提交确认/能力未接入”，这是定时意图配置入口，不是事件规则配置入口。
8. `vendor/lingtu-runtime/desk-v1/src/adapters/pdd-web.js:375-399` 有 sendImage/sendVideo hook包装，本轮没有调用它们；仅凭包装方法存在不能认定已获得平台能力、已获批准或已送达。

## 实际测试与已有原生证据

本轮新执行：

```text
npx vitest run tests/reception-scheduler.test.ts tests/reception-automation.test.ts tests/reception-scheduler-storage.test.ts tests/reception-scheduler-dialog.test.ts tests/reception-scheduler-ipc.test.ts --maxWorkers=1 --minWorkers=1
```

结果：**5文件24项 passed，退出0**。分项为调度12、事件4、文件2、弹窗4、IPC2；合成事件/临时文件/DOM检查，不连接平台、不发送消息。领域事件测试显式注入 `capability: () => ''`，故其 pending 断言仅证明注入条件下的队列行为，不能外推为生产 capability 或实店可用。

实际覆盖：一次/每日时区/间隔、DST重复时刻、重启取消旧pending且保留去重、旧工作区拒绝、店铺/会话重核验、满队列保护、任务版本/取消/过期、坏文件不覆盖、迟到刷新不覆盖新工作区/停用结果、事件时效及非空访客拒绝、跨店/停用规则不触发、已付款拒绝及无效转接目标拒绝。

只读复核统筹既有原生证据，**本轮没有重新运行原生构建或验收**：

- `artifacts/parallel-integration/restart-report.json`：pass=true，记录真实IPC工作区校验、定时UI新增启停与到期阻塞；realBuyerSends=0、payments=0。
- `artifacts/parallel-integration/scheduler-restart-report.json`：pass=true，第三独立进程恢复任务与blocked记录、未恢复批准；realBuyerSends=0、payments=0。
- `electron/parallel-integration-check.ts:334-375` 对应源码断言到期 `runs[0].state === 'blocked'`、店铺AI仍关闭、第三进程恢复blocked记录。这是调度和防护 **passed**，不是实际消息/催付/转接 **passed**。
- 同账号重新认证调度恢复按 `docs/parallel/INTEGRATION.md` 记录由统筹完成；本轮仅阅读，没有重复计入新执行24项。

## 当前缺口与合并表述

可以合并并表述为：本地调度/记录/恢复/隔离已验证，接待规则领域骨架及明确的未接入防护已实现。

不能表述为：无消息访客已自动欢迎、图片视频已自动发送、订单已自动催付或客服已自动转接，或事件规则已提供完整可用配置入口。

这些平台业务完成验收仍需要后续明确任务：接真实只读事件源；注册规则持久化生命周期与可用的产品编辑入口；把每个具体动作接入统一逐条批准及幂等提交/取消/过期机制；空会话、媒体与转接需相应基线和确认契约；订单在批准前重新核对状态。任何平台明确不支持的动作应继续 blocked。本轮只记录缺口，不新增功能、不尝试真实动作。
