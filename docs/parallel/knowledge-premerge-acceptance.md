# 知识领域合并前只读验收（2026-11-14）

## 给统筹的明确判定

**平台主动自动学习：未通过，当前未接通。** 不是只有实店验收证据缺失，而是“主动平台采集 → 学习任务 → 可恢复待审核候选 → 人工审核入库”的产品链路本身没有接好。不能把已有归档/本机商品候选、消息监控、售后/工单采集或已通过的知识原生专项当作主动自动学习成功。

**已有资料人工学习子集：本轮增量验证通过。** 可以准确描述为“从已有本机商品规格、当前已归档聊天及明确问答文本预览候选，人工确认后保存停用知识包，审核启用后参与知识检索”。若用户将“平台主动自动学习验收通过”设为合 main 的必要条件，此项仍是阻碍，不能用此子集测试通过代替整体通过；是否缩小交付范围由统筹与用户的既有授权决定，本次不开发、不提交或合并。

## 当前源码证据

| 核查点           | 现状与证据                                                                                                                                                                                                                                                                      | 判定                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 商品读取入口     | `src/modules/knowledge/services.ts` 的 products 仅执行 `list-products`，offset 0 / limit 100；`vendor/lingtu-runtime/electron/backend.cjs:263` 转给本机 products.list。没有从本领域发起平台商品全量读取。                                                                       | 本机第一页资料可用；主动平台商品学习未接通                                        |
| 聊天读取入口     | `ShopIntentLearnPanel.vue:26` 将 `runtime.snapshot.conversations` 直接交给 chatCandidates；没有在预览时调用平台历史接口。上游 backend.cjs:59–60 从 conversations.json 载入归档，消息 ingest 会更新它。                                                                          | 已归档候选可用；不是主动历史采集                                                  |
| 平台消息能力     | backend.cjs 的 startCollection → MessageMonitor.start；message-monitor.js 使用 drainEvents 观察接待消息，和回复队列解耦。PDD adapter 有 conversationHistory(uid, opts)（上限 100）和 consultGoods(uid)，属于指定会话历史/咨询商品能力；知识领域没有调用它们来创建学习任务。     | 是可研究复用的底层入口，不能等同店铺全量商品/聊天采集，实际平台可用性仍需单独核对 |
| 其他平台采集     | `electron/assist-platform-collector.ts` 遍历 ticket / aftersale 两种类型，收集辅助中心工单/售后。没有接入知识候选生成或知识审核。                                                                                                                                               | 不能用辅助中心采集成功证明学习采集成功                                            |
| 任务调度         | `src/shared/contracts/scheduler.ts` 的 automationActionSchema 仅含 welcome-text、welcome-image、welcome-video、transfer、payment-reminder；scheduler-runtime.ts 的定时执行没有学习 action。没有本领域的学习任务 ID、游标、增量续采、取消/恢复状态。                             | 后台主动/定时学习未接通                                                           |
| 待审核候选持久化 | ShopIntentLearnPanel 中 rows、LearningReview 中 selected/saved 都是 Vue ref；离开页面或重新生成列表会丢失未入库候选。                                                                                                                                                           | 没有持久化的待审核队列或重启恢复任务                                              |
| 人工确认后持久化 | createLearningService.confirm 显式校验确认、查询已有包去重，再执行 save-intent-pack。learning.ts 的 candidatePack 默认 enabled:false，并用停用审计条目保存 source/original/reviewed/productIds。上游 intent-knowledge.cjs 保存到已有知识文件并维护版本，JSON 导出保留审计条目。 | 已确认停用包可持久化；不是全套审核任务系统                                        |
| 审核启用/检索    | ShopIntentPanel 已支持人工启用并强制来源条目保持停用；来源审计不参加检索。此前真实 Electron 专项已验证经 UI 入库/启用后的实际训练请求含知识，跨店与商品范围隔离。                                                                                                               | 子集已验收；使用合成数据和本机固定测试模型，不证明实店或模型回答质量              |
| 界面入口         | `src/app/navigation.ts:31–32` 的 intent-doc / intent-chat 指向 ShopIntentLearnPanel；kb 指向尺码页；同文件 learn 仍映射 ShopWipPanel。`src/app/layouts/ShopManageView.vue:49` 的“商品自动学习”调用 notifyUnavailable 别名 \_\_stub。ShopWipPanel 展示“开发中”。                 | 人工候选入口已接；“商品自动学习”“学习任务”未接                                    |

## 通过项及证据边界

本次只读源码核查后执行：

```text
npx vitest run tests/knowledge-learning.test.ts tests/knowledge-learning-service.test.ts tests/knowledge-learning-ui.test.ts --maxWorkers=1 --minWorkers=1
```

**退出码 0，3 文件 14/14 通过（上海时间约 16:53）。** 覆盖候选来源/限界、同来源去重、原文与审核内容保存、真实上游临时知识文件持久化和检索、确认门、快照刷新保留草稿及工作区变化失效。没有新加测试来模拟不存在的平台主动采集。

真实 Electron **10/10** 是此前 16:30 的既有证据，本轮没有重跑原生验收，详情见 [knowledge-handoff.md](knowledge-handoff.md) 与 [既有报告](../../artifacts/knowledge-electron/evidence/2026-11-14T08-30-16-766Z/report.json)。其中归档由合成夹具初始化，商品由本机业务命令创建，不能把这些前置条件写成平台采集成功。

## 可复用现有接口与阻碍

- 可直接复用：现有 list-products / 商品 CSV 导入用于本机商品；snapshot.conversations 与归档合并用于已保留文字；learning.ts 的纯候选生成；createLearningService.confirm / save-intent-pack / 意图编辑启用 / 上游按店铺商品检索。这些只覆盖已存在资料到人工审核知识。
- 可评估的底层能力：PDD conversationHistory(uid, opts)、consultGoods(uid)、MessageMonitor/drainEvents、已有受信应用 IPC 校验和账号隔离生命周期。它们没有承诺全量覆盖，不能据名称推断分页、商品详情字段、权限或平台稳定性；验证码和登录失败必须保留为阻断。
- 尚缺正式契约：学习采集任务及其范围、平台商品列表/详情分页与身份来源、聊天枚举与游标、覆盖率/截断说明、任务进度与错误恢复、持久化待审队列、审核记录及确认前来源变化检查。来源审计当前是可维护知识条目，不是不可篡改审批日志；同服务去重不等于跨窗口原子唯一约束。
- 现有通用调度并没有学习动作；仅将 learn 导航改为候选页或添加一个定时按钮不能补齐平台读取和可恢复审核流程。

## 本轮执行边界

仅新增本文件。没有开发功能，没有修改公共文件、领域代码或已有交接，没有启动 build、Electron 或用户程序，没有操作平台浏览器、真实买家、付费模型或生产数据，没有提交、推送、合并、发布或部署。按冻结要求交由统筹作最终范围判定和 PR 处理。
