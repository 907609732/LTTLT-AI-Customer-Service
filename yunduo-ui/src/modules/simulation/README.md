# simulation 模块

本机模拟店铺（平台 id `sim-local`）的客服台界面：把模拟顾客页发来的消息呈现给坐席，并提交人工回复。

## 职责

- 只处理本机模拟店铺：店铺下拉、会话列表、聊天记录、回复输入都在这里。
- 消息来源是本机，不是真实平台：渲染层只读主进程快照 `snapshot.conversations` 里 `platform = sim-local` 的会话，
  不抓页面、不连网络、不写本机存储。
- 回复只提交候选文本：先 `select-conversation` 定位会话，再 `send-reply`，只有主进程 `confirmed === true`
  才算受理；未确认时保留草稿并把原因显示出来，不绕过统一确认门，也不改快照把未确认的回复显示成已发送。
- 模拟服务状态（是否运行、端口、地址）只以主进程回答为准；浏览器预览没有桥，如实显示“此操作需要桌面版”，
  不伪造在线或已启动。

## 数据来源

| 数据                             | 来源                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------- |
| 店铺列表、会话、消息             | 主进程后端快照 `/sim` 页面共享的 `useRuntimeStore()`                            |
| 打开店铺 / 选中会话 / 发送回复   | `runtime.run()` 命令白名单（`open-store`、`select-conversation`、`send-reply`） |
| 模拟顾客服务状态、打开模拟顾客页 | `services/simulator.ts` → `getDesktop()` 平台适配器                             |

`services/simulator.ts` 是渲染层接触桌面模拟能力的唯一入口，组件不直接读 `window.yunduoDesktop`。

## 公开入口：index.ts

`SimConsoleView`，以及服务函数 `listSimStores`、`isSimStore`、`simulatorSupport`、`readSimulatorStatus`、
`openSimulatorPage`。跨模块只引用 `index.ts`，不要深层引用 `components/` 或 `services/`。

## 界面入口

- 独立页面：路由 `/sim`（name `sim-console`）。
- 配置中心侧边栏：`src/app/navigation.ts` 的「开店准备 → 模拟客服台」（panel key `sim`）。

## 当前业务状态

本机模拟店铺已接入统一采集与回复链路，但它是演练能力：

- 没有真实平台登录、没有真实买家，消息只写在本机记录里；
- AI 生成的回复同样需要逐条人工确认后才发送；
- 图片/视频消息模拟店铺明确不支持，界面按文本展示，不假装支持。

改动此模块前请读 `AGENTS.md`、`docs/CONSTRAINTS.md`，并在完成后更新 `docs/HANDOFF.md`。
