# Adapter Contract v2

> core 与平台适配器之间的唯一耦合点。
> 代码常量：`src/shared/adapter-contract.js`（`CONTRACT_VERSION`、`ACCESS_MODES`、`METHODS`、`FAILURE_REASONS`）。
> 契约变更流程：改本文件 + `adapter-contract.js` → SendMessage 通知 `platform-hooks` → 两端同时升级。

## 0. 基本约定

- 一个适配器实例**只服务一个店铺**，在构造时绑定 `store`。所有方法不再接收 `store` 参数。
- `id` 是实例属性（字符串），例如 `pdd-web`；`accessMode` 也是实例属性，见 §1。
- `supports(platformId)` 用于适配器工厂选择，不参与运行期能力判断。
- 所有异步方法返回 Promise。
- 业务失败**必须**返回 `{ ok: false, reason: <失败枚举> }`；未知异常应直接抛出，由调用方记录并按异常处理，不得伪装成 `{ok:false}`。
- 适配器不得读写 `config.json`、不得访问密钥；需要配置时由构造参数注入只读快照。
- 适配器不得向任何远端上传 cookie / 凭据；登录态只留在自己的 session 分区。

成功/失败返回形状：

```ts
type Ok<T = {}> = { ok: true } & T;
type Fail = { ok: false; reason: 'hook_not_ready' | 'input_not_found' | 'input_busy' | 'send_unconfirmed'; detail?: string };
```

失败枚举（封闭集合，新增需升 `CONTRACT_VERSION`）：

| reason | 含义 | 调用方处理 |
|---|---|---|
| `hook_not_ready` | 页面 hook 未注入 / 页面未就绪 / 重载中 / 外部客户端尚未连接 | 归还队列，下一次 tick 重试；连续失败计入 attempts；非 webview 店铺会进入「等待外部客户端」状态 |
| `input_not_found` | 会话或输入框不存在（被关闭、切走、DOM 未渲染） | 归还队列并重试；不要重复发送 |
| `input_busy` | 输入框/发送按钮被占用（另一条消息在发） | 归还队列，禁止并发抢占 |
| `send_unconfirmed` | 点击发送后未能确认消息进入会话（可能已发出） | **不得自动重发**，归还队列由人工/去重兜底；记录告警 |

## 1. 接入方式 `accessMode`（v2 新增，必填）

```ts
type AccessMode = 'webview' | 'client-inject' | 'dual-hook';
```

| accessMode | 含义 | core 托管方式 | `entryUrlFor` |
|---|---|---|---|
| `webview` | 平台后台是普通网页，由 core 打开并注入 hook | `WebContentsView` + 店铺 preload，按 `entryUrlFor(store)` 加载 | **必需** |
| `client-inject` | 平台官方客户端已登录并运行，hook 注入到客户端页面 | 不建页面窗口；core 等待适配器 `ensure()` 成功 | 不需要 |
| `dual-hook` | 客户端内需要同时挂两条 hook（如 IM 列表 + 卖家 IM） | 同 `client-inject`，两段 hook 由适配器自行编排 | 不需要 |

主进程选择逻辑（`src/main/shop-window.js`、`src/main/index.js`）：

1. `accessMode` 由适配器实例声明；平台工厂可用 `accessModeFor(store)` / `accessModes` 预判。
2. `webview` → 查询 `entryUrlFor(store)`，缺 URL 视为配置错误（`entry_url_missing`）。
3. `client-inject` / `dual-hook` → **不创建 WebContentsView、不调 `loadURL`**，登记为 `awaiting_client` 并发出 `shop:awaiting_client` 事件。
4. 适配器 `ensure()` 在外部客户端连上前返回 `hook_not_ready`；core 仍创建 worker（不阻塞启动），由 tick 重试。
5. 外部客户端接入后 `ensure()` 转成功，引擎自动开始消费 pending；关闭店铺只注销托管，不杀外部客户端。

### 无入口 URL、等待外部客户端的启动流程

```
restoreStores()
  └─ shopWindow.open(store)
       ├─ accessMode !== 'webview'
       ├─ 记录 awaiting_client（不建窗口）
       └─ engine.startStore(store, { awaitReady: false })
            ├─ adapter.ensure() → {ok:false, reason:'hook_not_ready'}
            ├─ 非 webview 接入：记录 store:awaiting_client，继续启动 worker
            └─ tick 循环：popPending 失败 → 标记 degraded；成功后自动设 recoveredAt
```

**`entryUrlFor(store)` 是平台工厂的可选能力，不是适配器方法。** 平台层可以完全不实现它；core 只在 `accessMode === 'webview'` 时调用。

## 2. 方法清单（16 项，含 2 个属性）

| # | 成员 | 入参 | 成功返回 | 失败 |
|---|---|---|---|---|
| 1 | `id` | —（属性） | `string`，平台标识 | — |
| 2 | `accessMode` | —（属性） | `'webview' \| 'client-inject' \| 'dual-hook'` | — |
| 3 | `supports(platformId)` | `platformId: string` | `boolean` | 不抛异常 |
| 4 | `ensure()` | — | `{ ok: true }` 页面 hook 就绪 | `hook_not_ready` |
| 5 | `preparePending()` | — | `{ ok: true }` 已刷新内部待回复视图 | `hook_not_ready` |
| 6 | `popPending()` | — | `PendingRow \| null`（见 §3） | 一般不失败；异常直接抛 |
| 7 | `pendingSnapshot()` | — | `{ ok: true, count: number, uids: string[] }` | `hook_not_ready` |
| 8 | `conversationHistory(uid, opts?)` | `uid: string`, `opts?: {limit?: number}` | `{ ok: true, messages: Message[] }` 时间升序 | `hook_not_ready` / `input_not_found` |
| 9 | `sendText(uid, text, opts?)` | `uid`, `text: string`, `opts?: {timeoutMs?: number}` | `{ ok: true, msgId?: string }` | 4 种枚举 |
| 10 | `sendImage(uid, payload, opts?)` | `payload: {url?: string; base64?: string; filename?: string}`, `opts?: {}` | `{ ok: true, msgId?: string }` | 4 种枚举 |
| 11 | `sendVideo(uid, payload, opts?)` | 同 sendImage | `{ ok: true, msgId?: string }` | 4 种枚举 |
| 12 | `release(uid)` | `uid: string` | `{ ok: true }` 认领已归还 | `input_not_found` 可忽略 |
| 13 | `discard(uid, opts?)` | `uid`, `opts?: {beforeTs?: number}` | `{ ok: true }` 消息已消费/丢弃 | `input_not_found` 可忽略 |
| 14 | `popMerchantSent()` | — | `MerchantSentRow[]`（可为空） | 异常直接抛 |
| 15 | `syncAiEnabled(enabled)` | `enabled: boolean` | `{ ok: true }` 页面侧 AI 开关已同步 | `hook_not_ready` |
| 16 | `focusConversation(uid, opts?)` | `uid`, `opts?: {raise?: boolean}` | `{ ok: true }` | `input_not_found` |

`id`、`accessMode` 为属性，其余 14 项为方法；`METHODS` 常量只列方法名，`REQUIRED_MEMBERS` 含两个属性。

## 3. 数据结构

```ts
type Message = {
  msgId: string;                 // 平台消息 ID；缺失时用 `ts:<ts>` 兜底
  from: 'buyer' | 'seller' | 'system';
  type: 'text' | 'image' | 'video' | 'card' | 'order' | string;
  content: string;
  ts: number;                    // 毫秒时间戳
  raw?: unknown;                 // 调试用，core 不依赖
};

type PendingRow = {
  uid: string;                   // 买家会话 ID（同店唯一）
  messages: Message[];           // 至少包含触发本次回复的买家消息，时间升序
  username?: string;
  goodsTitle?: string;
  orderId?: string;
  claimedAt?: number;
};

type MerchantSentRow = {
  uid: string;
  message: Message;              // 客服（含人工与 AI 自身回环）已发出的消息
};
```

## 4. 队列语义

- 适配器维护内部 `pending` 表；`popPending()` **认领一条**并返回行，直到 `release(uid)` 或 `discard(uid)` 之前不得再次返回同一 uid。
- `release(uid)`：认领失败/未处理完，消息必须仍可被下次 `popPending()` 取到。
- `discard(uid, {beforeTs})`：消息已处理完毕，不再返回；`beforeTs` 用于丢弃该时间点之前的积压，防页面重载重放。
- `preparePending()` 只刷新视图，不认领。
- 同一 uid 的并发由 core 的 `processing` 集合与 `maxInflight` 双重保证；适配器仍需保证重复 `popPending` 不返回已认领 uid。
- `popMerchantSent()` 拉取卖家侧已发消息，用于：人工抑制、客服手动回复关键词、自发送回环识别。返回后适配器应清空该批次。
  - **自发送台账**：core 在 `sendText` 成功后记录 `(uid, msgId, 归一文本, 发送时刻)`；有 `msgId` 走精确匹配，无 `msgId` 走 8 秒文本兜底。适配器应尽量在 `sendText` 返回值里带 `msgId`。
- `dual-hook` 的跨通道去重由适配器负责；同一买家消息不得因两条 hook 各返回一次而重复入 pending。

## 5. 发送确认语义

- `sendText/sendImage/sendVideo` 成功返回前，适配器应确认消息已出现在会话（DOM 或消息流），不能只以「点击成功」为准。
- 无法确认时返回 `send_unconfirmed`，**不得**在适配器内部重试发送。
- 输入框竞态返回 `input_busy`，core 会归还队列稍后重试。
- 页面 hook 不可用时统一 `hook_not_ready`，不要抛具体 DOM 异常。
- 发送节奏由 core 控制（同 uid 最小间隔 60s、0.5~2s 抖动、单店每分钟上限），适配器不要自行加延时或队列。

## 6. 允许的扩展

- 适配器可以暴露额外方法（如 `selfTest`、`stats`、卡片动作、`anti` 状态），core 不依赖、不保证调用。
- 平台注入全局名（如 `window.__pddWeb`）属于适配器内部实现，不进契约。
- 新增 core 需要的方法必须升 `CONTRACT_VERSION` 并通知 `platform-hooks`。

## 7. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 1 | 2026-11-07 | 首版：15 项能力、4 个失败枚举、队列与发送确认语义 |
| 2 | 2026-11-07 | **破坏性**：新增必填属性 `accessMode`；`entryUrlFor` 降为平台工厂可选能力；补充无入口 URL / 等待外部客户端的启动流程；`popMerchantSent` 明确承载自发送回环识别 |
