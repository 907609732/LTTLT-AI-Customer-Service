# 云朵客服 · 持续开发工程

Vue 3 + TypeScript + Electron 客服工程，默认使用自己的模型 API Key，也可显式选择托管服务账号。桌面可保存店铺、商品知识、意图、规则、接待配置和本机工单，并接通训练、会话与回复服务；浏览器保持业务预览。

## 启动

```powershell
cd F:\Setupgod\yunduo-ui
npm ci
npm run electron:dev
```

只看浏览器：`npm run dev`；构建并启动桌面：`npm start`。

## 接功能前先读

本分支 UI 框架使用云朵客服的。只接入功能时可保留目标项目 UI；希望采用此 UI 时合并完整工程。具体入口、迁移顺序和验收要求见 [合并说明](docs/MERGE_GUIDE.md)。

| 文档                                       | 用途                                   |
| ------------------------------------------ | -------------------------------------- |
| [AGENTS.md](AGENTS.md)                     | AI 开工入口与完成规则                  |
| [项目约束](docs/CONSTRAINTS.md)            | 必须遵守的开发、类型、接口和安全边界   |
| [架构说明](docs/ARCHITECTURE.md)           | 目录、启动链路、模块和桌面能力         |
| [开发与接入](docs/DEVELOPMENT.md)          | 如何接第一项真实功能、后续 AI 任务模板 |
| [交接与待办](docs/HANDOFF.md)              | 当前能力、剩余问题与下一步验收         |
| [本地运维](docs/OPERATIONS.md)             | 环境、命令、日志与故障排查             |
| [架构决策](docs/DECISIONS.md)              | 关键取舍和本轮范围调整                 |
| [实时日志与发送确认](docs/RUNTIME_LOGS.md) | 消息、实际模型上下文与逐条批准发送     |
| [历史还原记录](docs/RESTORATION.md)        | 原始界面来源与还原过程，仅供参考       |

每个 `src/modules/<name>/README.md` 列出该模块职责与公开入口。

## 检查

买家消息下方的 [AI 处理状态与回复间隔设置](docs/MESSAGE_AI_STATUS.md) 说明每条消息是否发起模型请求及未回复原因。

上下文默认启用 [16K → 8K 压缩](docs/CONTEXT_COMPRESSION.md)，压缩回合与正式请求可在实时日志中核对。

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:desktop
```

`npm run check` 汇总类型、静态、格式、单元测试和构建。桌面检查独立运行，复用实际窗口与 IPC 实现；报告位于 `artifacts/desktop/report.json`，断言失败返回非零退出码。

## 当前能力边界

用户要求的 PR #21 服务端已独立导入 `server/`，包含 Go 托管 API、原生管理网页、固定上游锁和运行约束。设置中可选择模型来源、设备授权登录、刷新额度及打开管理后台；模式/账号切换需重启，账号工作区和平台登录分区独立。默认不连接托管服务、不自动开启 AI。运行 `npm run server:prepare`、`npm run server:verify` 验证服务端；来源、测试和回退见 [托管接入说明](docs/MANAGED_SERVICE.md)。

侧栏底部「快捷回复」已内置 80 条通用客服表达，可搜索、按场景筛选并复制；AI 回复与训练也会按当前问题参考最多 3 条。话术不替代本店知识，不改变逐条确认发送。维护与边界见 [通用话术说明](docs/GENERIC_PHRASES.md)。

保留原有 hash 路由、导航、窗口操作和主题。无需软件账号：打开设置，选择模型服务商或自定义兼容接口，填写自己的 Key 并测试保存，然后添加店铺与知识，在训练场验证后再连接实际店铺。每次启动 AI 默认关闭。

本机步骤和验证边界见 [本机密钥说明](docs/LOCAL_INTEGRATION.md)，可选托管账号及额度见 [托管接入说明](docs/MANAGED_SERVICE.md)。平台适配复用固定提交，真实平台登录、采集/发送与模型效果还需用户验收；软件计费、更多平台和定时调度仍未接入。
