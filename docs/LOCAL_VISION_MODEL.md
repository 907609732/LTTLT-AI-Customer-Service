# 本机独立图片识别模型（领域实现与接线契约）

本文件描述 2026-11-19 已实现的**本机独立视觉领域**。公共装配尚未完成：业务命令、快照投影、`local-runtime` 注入和登录弹窗挂载仍由后续统筹任务统一接线。当前代码不得被表述为“整个可配置视觉功能已交付”。

## 已完成范围

- `mode = inherit | custom` 的共享安全契约、状态与预设。
- 独立文件 `vision-model.json` 的严格校验、0600 临时文件写入 + fsync + rename 原子提交。
- Key 只通过注入的 Electron `safeStorage` 加解密；加密不可用时拒绝保存，不存在 base64/明文降级。
- 安全 revision CAS、内部 generation、业务目录 owner 绑定。
- 渲染层快照只含 `mode/baseUrl/model/apiKeyConfigured/status/reason`；不含 Key、密文、配置摘要、Key 代次或内部代次。设置页另用非秘密 `revision` 做并发写入；capabilities 不投影该字段。
- 缺文件默认 `inherit`：保留旧文字模型图片能力，但明确标为“未独立验证”，不强迫旧用户重新验证。
- `custom` 必须通过固定内置红/蓝上下顺序 PNG 的显式图片验证；普通 `/models` 连接测试不写入图片验证状态，提示本身不泄露颜色答案。
- Key 保存非秘密 origin（协议 + 主机 + 端口），跨 origin 换 Endpoint 时必须显式重新输入 Key；切换 inherit、清空地址也不会丢 Key 归属。后端拒绝且旧配置不变。同 origin 的路径或模型名变化可保留 Key。
- 图片验证套件版本由 `electron/vision-model-verification.ts` 唯一定义；旧/缺失/未知 suite 一律 stale，需重新验证，不能靠摘要恢复。
- 任何有效配置变化都会撤销旧图片验证，A→B→A 也必须重新验证，不能靠摘要复活。
- 已验证图片请求只在 **local + custom + 含真实 `image_url`** 时进入独立 OpenAI 兼容 `/chat/completions`；文字请求、`inherit` 和 managed 模式始终委托原端口，不静默回退。
- 独立组件 `VisionModelSettings.vue`，通过注入的 `VisionModelService` 工作；无服务时明确不可用，保存/连接/图片验证都需手动点击。
- 49 项专项测试，覆盖注入式 mock、真实 `node:http` 127.0.0.1 回环 HTTP、图片分流、文字端点隔离、跨 origin Key、inherit 空地址绕过、旧 Key origin 迁移、旧 suite 兼容、Key 不泄漏、继承兼容、过期响应、取消/超时、A→B→A 闭锁、原子写失败、普通文本不冒充图片验证、UI 草稿与清除确认。
- 设置页 CAS 使用安全 revision；Key 轮换即使可见字段不变也会递增 revision，旧设置页保存/清 Key 明确冲突。

## 文件与职责

| 文件                                                      | 职责                                                                 |
| --------------------------------------------------------- | -------------------------------------------------------------------- |
| `src/shared/contracts/vision.ts`                          | 安全快照、命令输入/回执、服务接口、地址与表单校验                    |
| `electron/vision-model-settings.ts`                       | 独立配置存储、safeStorage、Key、CAS、owner、验证票据、内部分流路由   |
| `electron/vision-model-runtime.ts`                        | 普通连接探针、固定合成图验证、知识模型包装端口、trace/usage 安全投影 |
| `src/modules/settings/vision-model-service.ts`            | DeepSeek 视觉预设、UI 草稿校验、组件注入类型                         |
| `src/modules/settings/components/VisionModelSettings.vue` | 独立可挂载设置组件；不直接网络、Electron 或持久化                    |
| `tests/vision-model-settings.test.ts`                     | 存储、加密、CAS、owner、验证失效                                     |
| `tests/knowledge-vision-routing.test.ts`                  | 注入/真实回环 HTTP、路由、隔离、过期/取消/超时、真实学习器接线       |
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
  "key": {
    "ciphertext": "<safeStorage密文base64>",
    "version": 1,
    "origin": "https://api.deepseek.com"
  },
  "verify": {
    "status": "verified",
    "digest": "<配置+Key代次摘要，不是Key指纹>",
    "owner": "<业务目录摘要>",
    "at": 1760000000000,
    "suite": 2
  }
}
```

约束：

- 缺文件不自动写默认文件；返回 `inherit`。
- 损坏或结构无效的文件明确报错并保留原文件，不静默回退。公共装配必须捕获该领域错误，让文字模型、接待和启动继续可用，同时独立视觉失败关闭；不能把错误吞成“已验证”或静默 inherit。
- 原子写先 fsync 临时文件，再 rename；rename 后尽力 fsync 目录（Windows 不支持时忽略）。失败清理临时文件不会覆盖主错误。
- 任何有效配置变化（Endpoint、模型、Key 版本、模式）都会移除旧验证；即使之后回到完全相同的旧值，也必须重新显式验证。
- 更换 origin 时如未输入新 Key，保存直接拒绝，不把旧 Key 发给新主机。
- Key origin 独立保存；`custom/A` → `inherit/空地址` → `custom/B` 不会把 A 的 Key 发给 B。旧文件缺少 origin 且已无地址证据时，要求重新输入 Key。
- 旧/未知 verification suite 读取为 stale；文件不改写，重新显式验证成功后才写当前 suite。
- 文件复制到另一业务目录时 owner 不匹配，旧验证显示 `stale`。
- Key 密文只由主进程解密；IPC/快照/日志不得返回。

## 状态语义

| status       | 含义                                                      |
| ------------ | --------------------------------------------------------- |
| `inherit`    | 沿用原文字模型图片能力；明确“未独立验证”                  |
| `unverified` | 已选独立模式但尚未成功完成固定图片验证                    |
| `verified`   | 当前端点、模型、Key 版本、目录 owner 均与成功验证记录一致 |
| `failed`     | 当前配置的固定图片验证请求或答案失败                      |
| `stale`      | 业务目录 owner 已变化，旧验证不可用                       |

设置服务通过 `VisionModelSettingsView = { snapshot, revision }` 返回安全 revision；`VisionModelSaveInput.expected` 和 `clearKey` 都带该 revision。`capabilities.visionModel` 仍只投影 `VisionModelSnapshot` 六字段，不把 revision 当成能力数据。验证成功/失败也会递增 revision，组件必须使用返回的新 revision 进行下一次清除/保存。

普通连接 `probe` 使用现有 `listCustomModels` 的 `/models` 校验、Bearer 鉴权和 20 秒超时，不改变 status，也不授予图片能力。外部取消与列表自身超时通过 `AbortSignal.any` 一直关联到响应体读取结束，不能只在响应头返回时拆除监听。

## 图片验证

- 图片是代码内固定生成的 64×64 PNG：上半区红、下半区蓝，仅用于内部探针；不使用客户图片，也不放宽正常知识图片来源。
- 提示只要求按从上到下的顺序回答两个区域颜色，不包含“红色/蓝色/red/blue”等答案词。
- 请求为 OpenAI 兼容：

```json
{
  "model": "deepseek-flash",
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "…按从上到下顺序回答两个区域的颜色…" },
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

- 只接受固定 fixture 的上下顺序答案：`红色、蓝色` / `红蓝` / `red, blue` 的紧凑等价形式；单一颜色、普通文字、忽略图片的回复、HTTP 失败都不会标记已验证。
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
npx vitest run tests/vision-model-settings.test.ts tests/knowledge-vision-routing.test.ts tests/vision-model-ui.test.ts --no-file-parallelism --maxWorkers=2 --minWorkers=1
# 3 files / 49 tests passed

npx vue-tsc --noEmit
npx tsc -p config/tsconfig.electron.json --noEmit
# passed

npx eslint --config config/eslint.config.mjs <changed files>
npx prettier --check <changed files> --config config/prettier.json --ignore-path config/prettier.ignore
# passed
```

未执行：真实模型/真实 Key、真实买家图片、托管服务、全量测试、打包、安装包、重启 GUI。

测试分层：

- 注入 `request` 的单元测试用于精确控制 body/时序；
- 至少一项使用原生 `node:http.createServer` 绑定 `127.0.0.1` 随机端口、原生 `fetch` 的真实回环 HTTP 测试，捕获验证提示、`image_url`、Authorization 和文字原端口隔离；
- 另有真实双端口测试证明跨 origin 未重输 Key 时 B 上游 0 次、新 Key 只发往 B；以及响应头已 flush、body 挂起时取消 probe 能有限结束。
- 全部使用临时目录、合成 Key/PNG 和 mock 服务，不访问真实外网或付费模型。

## 已知边界

- 当前只有领域与组件，公共 IPC、快照、挂载、预设入口和运行时装配未完成。
- 买家含图回复未分流；只覆盖知识图片学习。
- `probe` 依赖服务商提供兼容 `/models`；不提供时只能直接做图片验证。
- 图片验证要求服务商对固定红/蓝顺序图返回可核对的双颜色答案；不同模型可能因提示遵循或图像能力失败，这是预期闭锁，不是自动降级理由。
- 固定图仅用于内部验证，不替代真实商品图片识别质量验收。
