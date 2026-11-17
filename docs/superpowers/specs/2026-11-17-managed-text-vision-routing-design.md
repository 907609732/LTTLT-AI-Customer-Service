# 托管文字 / 图片分流设计（2026-11-17）

## 目标与已定方案

用户已明确选择并授权：托管模式下的**文字请求走 DeepSeek**，**含图片的请求自动走 Qwen3-VL**；新账号默认只允许这两个模型，试用额度 **100 次**。本轮只在本机隔离工作树实现与验证，不部署生产、不改真实账号数据库、不调用真实付费模型、不发布安装包。

## 现状与问题

- `lingtuhost/prepareChat` 先取策略默认模型/账号偏好，再看消息是否含图片；含图片但所选模型不是 `qwen3-vl-plus` 时直接 `400 vision_unavailable`。桌面从不发送 `model`，因此管理员把默认模型设为 DeepSeek 后，图片学习/识图请求永远被拒绝。
- 账号能力 `capabilities.vision` 由“默认文字模型是否支持图片”决定；默认模型是 DeepSeek 时能力为 false，桌面 `managed-session.cjs` 在发请求前就会拦截含图片的消息。即使服务端已配置 Qwen3-VL 也用不上。
- 默认试用策略是单模型（`model_scope` 为空，20 次），新账号天然拿不到视觉模型授权。

## 设计

1. **新装默认策略**（`lingtu.DefaultTrialPolicy`）：`calls=100`、`model_scope="selected"`、`allowed_models=["deepseek-flash","qwen3-vl-plus"]`、`default_model="deepseek-flash"`。只在“没有保存过试用策略”时生效；已保存策略、已发放额度一律不迁移、不改写。
2. **服务端自动分流**：客户端未显式指定 `model` 且消息含图片时，在**当前允许且就绪**的模型里选择第一个视觉模型（按模型 ID 稳定排序，即 Qwen3-VL），再按该模型准入、计费、记录。文字请求继续用策略默认模型/账号偏好（默认为 DeepSeek）。
3. **显式选择不被静默覆盖**：客户端显式指定了非视觉模型又带图片，仍返回 `400 vision_unavailable`；显式指定的视觉模型照旧可用。
4. **能力投影按分流结果**：`/api/client/me` 的 `capabilities.vision` 表示“该账号当前能发含图片请求”，即允许范围内存在就绪视觉模型；`capabilities.model` 仍为文字默认模型（桌面用它标注文字回复 trace），`max_images` 仍为 4。桌面 `managed-session.cjs` 的前置图片门因此只在真正没有视觉路由时才拦截。
5. **管理端试用设置**：只补必要说明与状态提示，复用现有 `Card`/`Label`/`p.text-sm.text-slate-500` 样式：
   - 说明文字请求使用默认模型、含图片请求自动使用允许范围内的视觉模型；
   - 当范围已设置但没有就绪视觉模型时，用琥珀色提示“含图片请求会被拒绝”。
6. **兼容与取舍**：
   - **有保存行时必须用旧默认基底解码**（20 次/7 天/无 scope/`allowed_models=nil`），只有“无行”才用新的 100 次/selected/双模型默认。否则旧 JSON 缺 scope 会被补上 scope 扩大授权，`all` 省略 allowed 会被填入默认列表而变成非法策略。
   - 已保存的旧策略（`model_scope` 为空）保持单模型行为，图片仍要求该模型本身支持视觉；`all` 与视觉别名保留原有回退语义。
   - **出厂双模型意图固定文字模型**：出厂策略下 DeepSeek 不可用时，文字与免费摘要返回 `503 model_not_ready`，在预留前中止且不转发，不静默改用 Qwen3-VL；图片仍走视觉模型。账号指定偏好若在允许范围内且就绪，属于显式选择，仍优先于默认模型；其他 scoped 策略保留“默认不可用时用其他允许模型”的既有回退。
   - 旧管理页只提交额度字段时保留已保存范围；`validateModelPolicy` 允许“上一版已允许、当前未配置”的模型继续留在范围内（新加入的模型仍要求就绪），避免新装只配 DeepSeek 时无法保存任何试用设置。
   - 不新增客户端协议字段、IPC、依赖或数据库列；不改 `vendor/lingtu-runtime`。
   - 桌面不发送 `model` 的行为不变，不需要改渲染层或 preload。

## 路由判定顺序

1. 解析策略与允许/就绪模型列表。
2. 显式 `model`：校验在范围内并使用该模型（图片请求仍要求其上游视觉能力）。
3. 未显式指定且不含图片：使用策略默认模型（出厂 DeepSeek）/账号偏好；出厂双模型下不可用即 fail-closed。
4. 未显式指定且含图片：使用允许范围内第一个就绪视觉模型；没有则 `400 vision_unavailable`。
5. 之后才做用途/学习校验、token 预算、额度预留与上游转发。所有拒绝都发生在预留之前。

## 验收标准

- 新库无策略行时：`DefaultTrialPolicy` 为 100 次、两模型、默认 DeepSeek；`EnsureManagedAccount` 发放 100 次。
- 文字聊天落到 `deepseek-flash`；含图片且未显式指定模型时落到 `qwen3-vl-plus`，上游请求体带图片与视觉模型。
- 允许范围不含视觉模型时，含图片请求 `400 vision_unavailable`，不预留额度；显式文字模型 + 图片仍拒绝。
- 该账号 `capabilities.vision=true`（有视觉路由）且 `model` 仍为文字默认模型。
- 定向 Go 包、管理页测试、`npm run server:verify` 通过；隔离 SQLite/本机夹具，无真实模型、无生产部署。

## 边界

- 不执行 `server/deploy`、`bootstrap-private.py`，不连接生产数据库或真实账号，不调用付费模型，不发布安装包。
- 服务端默认值不回溯改写已部署策略；如需线上生效，须由管理员在试用设置中显式保存并另行授权部署。
