# 托管文字/图片分流实施计划（2026-11-17）

工作树：`E:/codex-builds/lingtu-text-vision-routing-20261117`，分支 `codex/text-vision-routing-20261117`。只在工作树内修改，不部署、不调用真实付费模型、不改真实账号库、不发布。

## 1. 规划（完成）

| 项           | 决定                                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 默认试用策略 | 仅无保存行时：`calls=100`；`model_scope=selected`；`allowed_models=[deepseek-flash, qwen3-vl-plus]`；`default_model=deepseek-flash`。有保存行按旧基底（20/7/无 scope/nil allowed）解码，不覆盖 |
| 文字路由     | 策略默认模型/账号偏好解析结果（新装默认 DeepSeek）；出厂双模型下不可用即 `503 model_not_ready`，不静默用视觉模型                                                                               |
| 图片路由     | 客户端未指定 `model` 且消息含图片 → 允许范围内第一个就绪视觉模型（ID 稳定排序，即 Qwen3-VL）                                                                                                   |
| 显式模型     | 保持“不静默换模型”：显式非视觉模型 + 图片仍返回 `vision_unavailable`                                                                                                                           |
| 能力投影     | `capabilities.vision` = 存在就绪视觉路由；`model` 仍为文字默认模型                                                                                                                             |
| 兼容         | 已保存旧策略不变；旧管理页保留范围；允许“上一版已允许但当前未配置”的模型留在范围                                                                                                               |
| 不改动       | 桌面协议/渲染层、`vendor/lingtu-runtime`、数据库列、部署脚本                                                                                                                                   |
| 验证         | 定向 Go 测试（已红转绿）+ 管理页测试与 `npm run server:verify`（待 Codex）                                                                                                                     |

对应用例清单（先写失败用例再实现）：

1. 默认策略与首次发放：100 次、两模型、默认 DeepSeek。
2. 文字请求落到 DeepSeek；含图片请求自动落到 Qwen3-VL。
3. 范围不含视觉模型：图片请求 400 且不占额度；显式文字模型 + 图片仍 400。
4. `/me` 能力：文字默认 DeepSeek + 视觉路由就绪时 `vision=true`。
5. 管理端旧客户端只改额度时保留范围；未配置的“上一版允许模型”可保留。

## 2. UX（完成）

管理员视角（原生管理页 → 试用设置）：

- 保持现有卡片与字段顺序，不新增区块标题、不改布局；不新增“视觉模型”字段。
- 卡片顶部区分两件事：次数/并发只影响新发放额度；模型路由由下方范围控制。并说明文字用 DeepSeek、含图片请求自动用已授权的 Qwen3-VL、每次文字或图片请求扣 1 次试用额度。
- “可用模型范围”说明下补一句：文字用默认模型；含图片请求忽略账号默认偏好，自动用当前范围内已就绪的视觉模型。
- 范围已设置但没有就绪视觉模型时显示琥珀色提示：含图片请求将被拒绝，需启用并允许 Qwen3-VL 后恢复。
- 默认状态（新装、尚未配置视觉模型）：范围=指定模型，勾选 DeepSeek + Qwen3-VL，默认模型 DeepSeek，额度 100，同时出现上面的琥珀提示。
- 旧策略（范围为空）：不显示分流说明/警告，行为与以前一致。
- 文案长度控制在一到两句，复用现有 `text-sm text-slate-500` / `text-amber-700` 样式，不引入新组件。

## 3. UI（完成）

| 文件                                                         | 改动                                                                                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `server/overlay/web/src/features/lingtu/admin-page.tsx`      | `TrialRules` 顶部额度/路由说明；范围已设置时渲染分流说明与缺视觉模型警告（按 `upstream_model === 'qwen3-vl-plus'` 判断就绪） |
| `server/translations.json`                                   | 新增三条英文键及中文译文                                                                                                     |
| `server/overlay/web/src/features/lingtu/admin-page.test.tsx` | 新增：无就绪视觉模型时显示警告、有就绪视觉模型时不显示                                                                       |

视觉判断：沿用蓝色卡片、灰色说明、琥珀警告；不新增按钮或弹窗。最终文案与截图由 Codex 复核。

## 4. 开发（完成）

| 文件                                                       | 改动                                                                                                                          |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `server/overlay/lingtu/settings.go`                        | 分开旧默认基底与出厂默认；有行按旧值解码，无行才用 100 次/selected/双模型                                                     |
| `server/overlay/lingtuhost/model_policy.go`                | 图片模型选择；出厂双模型文字固定（DS 不可用即 fail-closed）；`validateModelPolicy` 允许保留“上一版允许但当前未配置”的模型     |
| `server/overlay/lingtuhost/chat.go`                        | 未显式指定模型且含图片时改选视觉路由；显式选择保持原语义                                                                      |
| `server/overlay/lingtuhost/routes.go`                      | `/me` 能力按视觉路由投影，`model` 仍为文字默认模型                                                                            |
| `server/overlay/lingtu/default_policy_test.go`             | 新自有测试：出厂默认、旧 JSON 缺 scope、all 省略 allowed、selected 仅 DS、无行默认                                            |
| `server/overlay/lingtuhost/text_vision_acceptance_test.go` | Codex 新增自有验收测试（3 项，已独立通过）                                                                                    |
| 既有测试                                                   | 新增分流/固定文字/能力/范围保留用例；仍在验证旧单模型路径的用例显式保存旧策略；授予额度断言改用默认值；`all` 夹具清空 allowed |

## 5. 验证

实际执行与结果：

1. GitHub 不可达，改用本机固定上游 clone（HEAD 48a6c87…，干净）；`npm run server:prepare` 退出 0。
2. RED：`go test ./lingtu -run 'TestTrial(...)'` 旧 JSON 缺 scope、all 省略 allowed 失败；`go test ./lingtuhost -run 'TestLingtuModelPolicyAllScope…|TestLingtuVisionTextNeverFallsBack…|TestLingtuVisionCapabilityKeepsText…'` 三项失败。均退出 1。
3. GREEN：`go test ./lingtu -run 'TestTrial'` 退出 0（4.711s）；`go test ./lingtuhost -run 'TestLingtuModelPolicy|TestLingtuVision'` 退出 0（35.026s，首次因两个 `all` 夹具未清 allowed 失败，修正夹具后通过）。
4. Codex 独立运行 `text_vision_acceptance_test.go` 3 项退出 0（2.486s）。
5. 待 Codex：全量 `go test ./lingtu ./lingtuhost`（后台任务未取得结果）、其余 Go 包、`npm run server:verify`、翻译/类型/lint/网页构建、管理页 UI 测试（一次运行被中断，结果未知）。详见 `docs/VALIDATION.md` 与 `docs/HANDOFF.md`。

## 6. 记录（按顺序）

- 规划：确认默认策略、路由判定、能力投影与兼容边界，列出先失败后实现的用例。
- UX：顶部区分“新发放额度”与“全局模型路由”，补 DS/VL/每次扣 1 次；范围说明与缺视觉模型警告；旧策略不显示。
- UI：只改试用设置卡片、其测试与翻译，复用现有组件和样式。
- 开发：服务端默认策略、旧策略解码、图片分流、文字固定、能力投影与管理端提示；桌面协议与 vendor 不动。
- 验证：定向 RED→GREEN 完成；全量服务端/管理页/桌面验证留给 Codex。
- 收尾：版本 1.0.48；source-files.json 仅同步实际改动文件的 sha256 并保留原始来源哈希，新增测试声明自有；UI/翻译最终哈希待 Codex。未提交、未部署。
