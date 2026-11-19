# 托管商品详情学习根因修复（2026-11-19）

## 结论

桌面学习的失败根因不是提示词或 UI：`createKnowledgeLearner` 只调用 `KnowledgeModelPort.complete`，没有告知托管传输这是商品详情学习，服务端因此按普通 chat 处理，`candidates` 无法成为有效回复；首调用后任务只能按“结果不确定”进入 `needs-confirmation`。本修复只改桌面主进程学习调用链，不修改 vendor、server、版本或普通回复逻辑。

## 实现

- `electron/knowledge/learning.ts` 新增学习预检/提交钩子；托管模式下 submitted checkpoint 由适配器在来源、策略、账号和取消检查通过后调用，避免预检失败被误记为可能计费。旧版托管估算缺少协议标记时要求重新估算；旧的 submitted/needs-confirmation 任务不自动重放。已知服务端在额度预留前返回的策略/格式拒绝会落为 `failed` + ready checkpoint；未知结果仍保留人工 uncertain 门。
- `electron/knowledge-runtime.ts` 只新增主进程 model-port 契约：学习来源/图片标记、预检能力与提交回调。普通 reply/trial 调用不传学习字段。
- 新增 `electron/managed-learning.ts`：仅接受当前店铺为 `pdd-web`、商品关联有效、采集器标签与拼多多 HTTPS 详情地址一致的静态/动态文字或图片；普通文档、聊天、其他平台、未知标签和伪造 URL 都明确失败。它派生 `purpose=learning`、当前策略 `policy_version`、`learning_source` 和策略 `max_output_tokens`，再由既有托管 chat 发送；不接受调用方直接声明这些字段。
- `electron/managed-controller.ts` 新增严格学习策略预检：每次学习调用重新读取当前 `/api/client/config`，不沿用接待路径 60 秒缓存；旧服务端、禁用、来源未允许、图片策略/账号能力不足、账号切换/登出和取消均在本地失败。普通 `chat` 与 `contextPolicy` 的既有路径保持。
- `electron/local-runtime.ts` 仅在 managed 模式将学习适配器包在现有视觉端口外；local Key 模式不注入适配器。
- 文档同步到 `docs/MANAGED_SERVICE.md` 与 `src/modules/knowledge/README.md`。

## RED / GREEN

RED（实现前，精确捕获了用户现象）：

```text
npx vitest run tests/knowledge-model-learning.test.ts -t "preflights a managed learning call" --reporter=verbose
× expected 'needs-confirmation' to be 'succeeded'
Tests 1 failed | 25 skipped
exit 1
```

GREEN（实现后，最终定向集合）：

```text
npx vitest run tests/knowledge-model-learning.test.ts tests/managed-knowledge-learning.test.ts tests/managed-context-policy.test.ts tests/managed-context-transport.test.ts tests/knowledge-vision-routing.test.ts tests/vision-model-integration.test.ts tests/knowledge-runtime.test.ts tests/knowledge-learning.test.ts tests/knowledge-batch-learning.test.ts tests/knowledge-durable-learning-ui.test.ts --reporter=dot
Test Files 10 passed (10)
Tests 112 passed (112)
exit 0
```

覆盖：精确 typed wire、普通/空 candidates、普通 reply 无新增字段、PDD 文字/图片来源、非 PDD/未知来源拒绝、旧服务端、策略禁用/来源限制/视觉限制、账号切换/取消、托管队列取消不提前提交、预提交失败 ready checkpoint、已知计费前拒绝、旧估算拒绝和 uncertain 人工门。

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
- `max_calls_per_product` 仍是现有服务端契约中尚未执行的单商品限流；桌面不静默丢弃资料，也不把未发送的资料计为成功。
- 本交付需要 Codex 独立审查和后续整合；执行完成不等于线上修复或验收完成。
