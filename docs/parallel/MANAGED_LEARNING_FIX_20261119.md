# 托管商品详情学习根因修复（2026-11-19）

## 结论

桌面学习的失败根因不是提示词或 UI：`createKnowledgeLearner` 只调用 `KnowledgeModelPort.complete`，没有告知托管传输这是商品详情学习，服务端因此按普通 chat 处理，`candidates` 无法成为有效回复；首调用后任务只能按“结果不确定”进入 `needs-confirmation`。本修复只改桌面主进程学习调用链，不修改 vendor、server、版本或普通回复逻辑。

## 实现

- `electron/knowledge/learning.ts` 新增学习预检/提交钩子；托管模式下 submitted checkpoint 由适配器在来源、策略、账号和取消检查通过后调用，避免预检失败被误记为可能计费。旧版托管估算缺少协议标记时要求重新估算；旧的 submitted/needs-confirmation 任务不自动重放。已知服务端在额度预留前返回的策略/格式拒绝会落为 `failed` + ready checkpoint；未知结果仍保留人工 uncertain 门。
- `electron/knowledge-runtime.ts` 只新增主进程 model-port 契约：学习来源/图片标记、预检能力与提交回调。普通 reply/trial 调用不传学习字段。
- 新增 `electron/managed-learning.ts`：仅接受当前店铺为 `pdd-web`、商品关联有效、采集器标签与拼多多 HTTPS 详情地址一致的静态/动态文字或图片；普通文档、聊天、其他平台、未知标签和伪造 URL 都明确失败。它派生 `purpose=learning`、当前策略 `policy_version`、`learning_source` 和策略 `max_output_tokens`，再由既有托管 chat 发送；不接受调用方直接声明这些字段。
- `electron/managed-controller.ts` 新增严格学习策略预检：每次学习调用重新读取当前 `/api/client/config`，不沿用接待路径 60 秒缓存；旧服务端、禁用、来源未允许、图片策略/账号能力不足、账号切换/登出和取消均在本地失败。普通 `chat` 与 `contextPolicy` 的既有路径保持。
- `electron/local-runtime.ts` 仅在 managed 模式注入学习适配器，并直接以托管 `basePort` 为基础，绕过本地视觉包装层在 vendor 队列前调用 `isCurrent`；local Key 模式不注入适配器。
- 文档同步到 `docs/MANAGED_SERVICE.md` 与 `src/modules/knowledge/README.md`。

## 独立审查续修（2026-11-19）

- 审查项 1：`createKnowledgeSourceModel` 与 `knowledge-runtime` 动态转发 `prepareLearning`；local Key 的 getter 返回 undefined，不要求托管协议。真实装配测试覆盖 assembly → runtime → managed adapter → vendor `backend.cjs` mock transport，确认 wire 的 `purpose/policy_version/learning_source`；旧服务策略失败时 `managedChat` 调用数保持 0。
- 审查项 2：旧 local Key 估算不因缺少 `plan.version=2` 被拒绝；新增旧 local start、paused、received、submitted 用例。submitted 普通继续仍拒绝，显式 skip/retry 门保留。
- 审查项 3：`maxCallsPerProduct` 从策略进入 adapter/learner；按 `storeId + productId` 汇总根商品、SKU、文本分段和图片分块，在创建任务前和 submitted 边界都拒绝超限，不截断批次。
- 审查项 4：submitted 标记只通过 vendor managed queue 的 `isCurrent` 边界触发；本地 runtime 的 `assertReady` 同时检查持久 `modelIssue`。队列前暂停、队列中暂停和持久暂停测试均为 chat=0、checkpoint 非 submitted。managed 学习绕过本地视觉包装，避免其提前调用内层回调。
- 审查项 5：start 在预检后用同一 repo 事务复读 estimate、createJob、清空 estimate；并发同 estimate 仅 1 个 job/1 次模型调用，预检失败保留重新启动能力。
- 审查项 6：提交边界重新 `validate(plan)` 并复核来源语义和单商品上限；策略等待期间 source revision 改变时 chat=0、checkpoint ready。缺少提交 hook 的 managed port 不再被静默补标记为成功，而是 checkpoint submitted + 人工 uncertain。

## RED / GREEN

RED（实现前，精确捕获了用户现象）：

```text
npx vitest run tests/knowledge-model-learning.test.ts -t "preflights a managed learning call" --reporter=verbose
× expected 'needs-confirmation' to be 'succeeded'
Tests 1 failed | 25 skipped
exit 1
```

审查续修 RED（逐项临时恢复旧行为，运行后立即还原，未提交 RED 变体）：

| 审查项       | RED 结果                                     |
| ------------ | -------------------------------------------- |
| 1 装配转发   | 2 项失败，真实请求缺学习用途、策略版本与来源 |
| 2 旧本机计划 | 2 项失败，旧本机任务被新版估算门阻止         |
| 3 商品上限   | 4 项失败，超限计划仍创建任务                 |
| 4 队列边界   | 2 项失败，暂停/取消前已错误标记提交          |
| 5 原子消费   | 1 项失败，同一估算两个启动请求均成功         |
| 6 来源变化   | 1 项失败，来源变化后仍接收模型结果           |

各项精确命令与输出保留在执行者 events-round2.jsonl；RED 变体运行后立即恢复，再运行完整定向 GREEN。

GREEN（实现后，最终定向集合）：

```text
npx vitest run tests/knowledge-model-learning.test.ts tests/managed-knowledge-learning.test.ts tests/managed-context-policy.test.ts tests/managed-context-transport.test.ts tests/knowledge-vision-routing.test.ts tests/vision-model-integration.test.ts tests/knowledge-runtime.test.ts tests/knowledge-learning.test.ts tests/knowledge-batch-learning.test.ts tests/knowledge-durable-learning-ui.test.ts tests/knowledge-pipeline-factory.test.ts --reporter=dot
Test Files 11 passed (11)
Tests 128 passed (128)
exit 0
```

覆盖：精确 typed wire、真实 assembly 转发、旧服务 chat=0、普通/空 candidates、普通 reply 无新增字段、PDD 文字/图片来源、非 PDD/未知来源拒绝、旧服务端、策略禁用/来源限制/视觉限制、账号切换/取消、持久 pause、队列中 pause、队列取消不提前提交、单商品调用上限（文本/SKU/图片）、并发消费 estimate、预提交失败 ready checkpoint、来源变化、已知计费前拒绝、旧 local/托管估算与 uncertain 人工门。

## 静态验证

```text
npx tsc -p config/tsconfig.electron.json --noEmit        exit 0
npx vue-tsc --noEmit                                     exit 0
npx eslint ...changed files...                           exit 0
npx prettier --check ...changed files...                  exit 0
node scripts/check-boundaries.mjs                        exit 0
```

## 未覆盖与部署前置

- 未访问真实账号、客户原文、平台、正式数据库、线上托管服务或真实模型；未启动 GUI，未构建/打包，未部署/发送。
- 未验证真实拼多多页面采集到托管的端到端链路，也未验证供应商实际计费或旧线上服务升级。
- 线上服务端必须先部署带当前 `/api/client/config` 学习投影和 typed learning 校验的版本。旧服务端上桌面会明确提示“需要服务端支持、学习请求未发送”，不会改用普通 reply、免费 summary 或自动重试。
- 桌面已按 `max_calls_per_product` 汇总真实商品调用并在建任务/提交前明确失败；服务端自身仍未执行单商品限流。桌面不静默丢弃资料，也不把未发送的资料计为成功。
- 本次记录的是独立审查问题修复，Codex 复核通过前不能宣称线上学习已恢复；`final.completed` 仅表示执行完成。
- 更新回执后仍需生产部署、启用策略、真实模型/旧服务兼容和实店验收；这些均未验证。

## 主线整合与本机候选（1.0.80）

Codex 已复核实际修订与 RED/GREEN，一次独立只读审查的六项阻塞均关闭。主线保留 DeepSeek 两次提交和未提交现场；源码/锁文件统一 1.0.80，`npm run build` exit 0。只做源码构建，没有安装包、tag 或公开 Release，也未重启原账号在线窗口。

实际六商品计划按商品需 8、8、16、17、25、37 次，共 111 次。为保留完整资料，整合时同步扩展桌面安全投影、Go 校验、原生管理表单的可配置上界至 40；默认仍为 20、学习默认关闭，实际提高预算须管理员显式保存。新增桌面边界测试 RED 为 37/40 被拒绝，GREEN 为 6/6；管理表单 8/8 验证显式保存 37 不开启学习及 41 拒绝。相关 Go ContextPolicy、chat policy、视觉/模型路由及服务版本/匿名拒绝回归通过，未请求真实模型。Native 深目录测试因环境解析 `/src/test-setup.ts` 未启动，未计为通过；复用官方脚本规定的物理验证缓存与冻结锁后 8 项通过，类型检查和原生页面构建通过。

后台本机候选标识 `2026.11.19-learning.1`、计费协议 2，保留既有能力，新增学习协议声明。原生管理页与 Linux amd64 二进制已准备，哈希和测试证据在主目录 `artifacts/managed-learning-fix-integration-20261119/`；执行者原始记录与精简回执复制到其中 `executor/`，原隔离工作树亦保留。格式化只涉及本次管理端文件，保留许可和来源清单；没有部署、改实际策略、清暂停或重试旧任务。

当前线上仍是旧 `support.1`，已有学习失败暂停和旧任务需按原确认流程处理。上线前须确认升级服务、启用 PDD 学习及实际单品预算；默认 20 无法完整处理其中两件。后续单次受控样例须明确授权，不自动消费旧估算、重试 111 步任务、开启店铺 AI 或向买家发送。
