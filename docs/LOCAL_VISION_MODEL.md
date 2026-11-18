# 本机独立图片识别模型（领域实现与接线契约）

本文件描述 2026-11-19 已实现的**本机独立视觉领域**。公共装配尚未完成：业务命令、快照投影、`local-runtime` 注入和登录弹窗挂载仍由后续统筹任务统一接线。当前代码不得被表述为“整个可配置视觉功能已交付”。

## 已完成范围

- `mode = inherit | custom` 的共享安全契约、状态与预设。
- 独立文件 `vision-model.json` 的严格校验、0600 临时文件 + rename 原子写入。
- Key 只通过注入的 Electron `safeStorage` 加解密；加密不可用时拒绝保存，不存在 base64/明文降级。
- 可见配置 CAS、内部 revision/代次、业务目录 owner 绑定。
- 渲染层快照只含 `mode/baseUrl/model/apiKeyConfigured/status/reason`；不含 Key、密文、配置摘要、Key 代次或内部代次。
- 缺口文件默认 `inherit`：保留旧文字模型图片能力，但明确标为“未独立验证”，不强迫旧用户重新验证。
- `custom` 必须通过固定内置合成 PNG 的显式图片验证；普通 `/models` 连接测试不写入图片验证状态。
- 已验证图片请求只在 **local + custom + 含真实 `image_url`** 时进入独立 OpenAI 兼容 `/chat/completions`；文字请求、`inherit` 和 managed 模式始终委托原端口，不静默回退。
- 独立组件 `VisionModelSettings.vue`，通过注入的 `VisionModelService` 工作；无服务时明确不可用，保存/连接/图片验证都需手动点击。
- 32 项专项测试，覆盖 mock HTTP body、图片分流、文字端点隔离、Key 不泄漏、继承兼容、过期响应、取消/超时、普通文本不冒充图片验证、UI 草稿与清除确认。
- 设置页 CAS 使用安全 revision；Key 轮换即使可见字段不变也会递增 revision，旧设置页不能覆盖新 Key。

## 文件与职责

| 文件                                                      | 职责                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/shared/contracts/vision.ts`                          | 安全快照、命令输入/回执、服务接口、地址与表单校验                    |
| `electron/vision-model-settings.ts`                       | 独立配置存储、safeStorage、Key、CAS、owner、验证票据、内部分流路由   |
| `electron/vision-model-runtime.ts`                        | 普通连接探针、固定合成图验证、知识模型包装端口、trace/usage 安全投影 |
| `src/modules/settings/vision-model-service.ts`            | DeepSeek 视觉预设、UI 草稿校验、组件注入类型                         |
| `src/modules/settings/components/VisionModelSettings.vue` | 独立可挂载设置组件；不直接网络、Electron 或持久化                    |
| `tests/vision-model-settings.test.ts`                     | 存储、加密、CAS、owner、验证失效                                     |
| `tests/knowledge-vision-routing.test.ts`                  | mock HTTP、路由、隔离、过期/取消/超时、真实学习器接线                |
| `tests/vision-model-ui.test.ts`                           | 继承/独立模式、显式动作、失败草稿、清 Key 确认、迟到 UI 结果         |

## 数据文件

位置：当前本机业务目录下的 `vision-model.json`。

内部结构仅主进程使用：

```json
{
  "version": 1,
  "owner": "<业务目录摘要>",
  "revision": 2,
  "generation": 3,
  "mode": "custom",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-flash",
  "key": { "ciphertext": "<safeStorage密文base64>", "version": 1 },
  "verify": {
    "status": "verified",
    "digest": "<配置+Key代次摘要，不是Key指纹>",
    "owner": "<业务目录摘要>",
    "at": 1760000000000,
    "suite": 1
  }
}
```

约束：

- 缺文件不自动写默认文件；返回 `inherit`。
- 损坏或结构无效的文件明确报错并保留原文件，不静默回退。公共装配必须捕获该领域错误，让文字模型、接待和启动继续可用，同时独立视觉失败关闭；不能把错误吞成“已验证”或静默 inherit。
- 原子写先 fsync 临时文件，再 rename；rename 后尽力 fsync 目录（Windows 不支持时忽略）。失败清理临时文件不会覆盖主错误。
- 端点、模型、Key 版本、模式改变使旧验证失效；模式变化直接移除旧验证，防止 `custom → inherit → custom` 后自动复活。
- 文件复制到另一业务目录时 owner 不匹配，旧验证显示 `stale`。
- Key 密文只由主进程解密；IPC/快照/日志不得返回。

## 状态语义

| status       | 含义                                                      |
| ------------ | --------------------------------------------------------- |
| `inherit`    | 沿用原文字模型图片能力；明确“未独立验证”                  |
| `unverified` | 已选独立模式但尚未成功完成固定图片验证                    |
| `verified`   | 当前端点、模型、Key 版本、目录 owner 均与成功验证记录一致 |
| `failed`     | 当前配置的固定图片验证请求或答案失败                      |
| `stale`      | 端点/模型/Key 或目录已变化，需重新验证                    |

设置服务通过 `VisionModelSettingsView = { snapshot, revision }` 返回安全 revision；`VisionModelSaveInput.expected` 和 `clearKey` 都带该 revision。`capabilities.visionModel` 仍只投影 `VisionModelSnapshot` 六字段，不把 revision 当成能力数据。验证成功/失败也会递增 revision，组件必须使用返回的新 revision 进行下一次清除/保存。

普通连接 `probe` 使用现有 `listCustomModels` 的 `/models` 校验、Bearer 鉴权和 20 秒超时，不改变 status，也不授予图片能力。

## 图片验证

- 图片是代码内固定生成的 64×64 红色系 PNG，仅用于内部探针；不使用客户图片，也不放宽正常知识图片来源。
- 请求为 OpenAI 兼容：

```json
{
  "model": "deepseek-flash",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "…只回答“红色”…" },
        {
          "type": "image_url",
          "image_url": { "url": "data:image/png;base64,..." }
        }
      ]
    }
  ],
  "max_tokens": 8,
  "stream": false
}
```

- 只接受可核对答案 `红色` / `red`（允许首尾引号和句末标点）。任意非空文本、忽略图片的文字回复、HTTP 失败都不会标记已验证。
- 验证结果写入前复核 revision、generation、配置摘要和 owner；配置在请求期间改变时，迟到结果不能写入新配置。

## 知识模型包装端口

`VisionModelRuntime.knowledgePort()` 返回：

```ts
{
  complete(input): Promise<string>
  vision(): { supported: boolean; maxImages: number; reason: string }
  identity(): string
  minimumIntervalMs(): number
}
```

分流规则：

1. only `modelSource() === 'local'`；
2. 当前 `mode === 'custom'`；
3. `messages` 中真实存在 `image_url`；
4. 当前验证仍为 `verified`。

满足时解密独立 Key，调用 `${baseUrl}/chat/completions`；否则原样调用 base port。`inherit` 图片继续走原端口；managed 图片和文字永远走原端口。自定义模式未验证、Key 不可解密或独立端点失败时明确报错，不回退。

`complete` 在返回前复核：

- 外部 `AbortSignal`；
- 调用方 `isCurrent()`；
- 注入的当前 workspace `assertActive()`；
- 视觉配置内部 generation。

任一失效都抛错，使知识学习不会把过期响应写入 `received` 检查点。图片 HTTP 请求支持调用方超时（上限 120 秒），并保留现有 usage/trace 口径；`onTrace` 只接收 `traceId/model/usage` 安全字段。

`identity()` 返回 base identity 加 `vision:${mode}:${generation}`。generation 只在主进程存在，知识学习计划据此重新估算；不进入渲染快照。

## 后续公共装配清单（尚未完成）

后续统筹 worker 需要统一完成，本文不声称已接通：

1. 在 `src/shared/contracts/backend.ts` 增加四个命令 `save-vision-model-settings`、`probe-vision-model`、`verify-vision-model`、`clear-vision-key`，并校验输入/回执。
2. 在 `electron/local-runtime.ts`：
   - 用真实 Electron `safeStorage` 创建 `VisionModelSettingsStore`，传入当前业务目录和当前 workspace `assertActive`；
   - 创建 `VisionModelRuntime`，base port 使用现有 `onKnowledgeModel` 得到的文字/托管端口；
   - `modelSource` 返回当前 `managed.active.mode`；
   - 将 `knowledge.setModel(visionRuntime.knowledgePort())` 放在原端口装配位置；
   - 只在 local 分支使用独立路由；managed 保持原端口。
3. 在快照 `capabilities.visionModel` 只投影安全 `VisionModelSnapshot`，不得转发 `generation/revision/digest/keyVersion`；设置页单独使用 `VisionModelSettingsView.revision` 做 CAS。
4. 在 `electron/model-capabilities.ts` 兼容旧调用：`inherit` 保持旧图片能力但标记未验证；`custom` 只在已验证时开放。不要修改本批文件。
5. 在 `LoginDialog` 挂载 `VisionModelSettings`，并通过 settings 模块服务适配四个命令；组件不直接调用 runtime/IPC。
6. 在 `src/modules/settings/index.ts` 导出组件/服务，在 settings README 更新入口说明，决定是否加入 `model-presets`。本批未改这些公共文件。
7. 评估买家含图回复是否进入独立视觉路由。本批不做；现有买家图片回复保持原路径。
8. 托管视觉渠道、授权、额度预留与管理员验证属于 Task 3 server 范围，本批未改 server。

建议装配形状：

```ts
const visionStore = new VisionModelSettingsStore({
  dataDir: managed.dataDir,
  safeStorage,
  assertActive: () => workspace.assertActive(),
})
const visionRuntime = new VisionModelRuntime({
  store: visionStore,
  base: existingKnowledgeModelPort,
  modelSource: () => managed.active.mode,
  assertActive: () => workspace.assertActive(),
})
knowledge.setModel(visionRuntime.knowledgePort())
```

接线时需复核 `existingKnowledgeModelPort` 已包含原 managed/local 身份、图片门禁、限速、trace/用量和取消能力；不要把 `VisionModelRuntime` 叠成第二套通用 SDK。

## 验证

实际执行：

```text
npx vitest run tests/vision-model-settings.test.ts tests/knowledge-vision-routing.test.ts tests/vision-model-ui.test.ts --no-file-parallelism --maxWorkers=1
# 3 files / 32 tests passed

npx vue-tsc --noEmit
npx tsc -p config/tsconfig.electron.json --noEmit
# passed

npx eslint --config config/eslint.config.mjs <changed files>
npx prettier --check <changed files> --config config/prettier.json --ignore-path config/prettier.ignore
# passed
```

未执行：真实模型/真实 Key、真实买家图片、托管服务、全量测试、打包、安装包、重启 GUI。测试使用本机回环 mock HTTP、临时目录和注入的加密替身。

## 已知边界

- 当前只有领域与组件，公共 IPC、快照、挂载、预设入口和运行时装配未完成。
- 买家含图回复未分流；只覆盖知识图片学习。
- `probe` 依赖服务商提供兼容 `/models`；不提供时只能直接做图片验证。
- 图片验证要求服务商对固定红色合成图返回可核对答案；不同模型可能因提示遵循或图像能力失败，这是预期闭锁，不是自动降级理由。
- 固定图仅用于内部验证，不替代真实商品图片识别质量验收。
