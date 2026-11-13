# 本地运行与运维

主项目根为 F:\Setupgod\yunduo-ui。所有命令从这里运行，目录与保留范围见 PROJECT_LAYOUT.md；不要进入 \_github 或旧推送工作区维护本项目。用户已授权本轮分支推送与 main 合并，范围见 MAIN_DELIVERY_20261114.md；公开发布和生产部署另行授权。

实时调试窗口：工作台标题栏“日志”。消息和 AI 请求调试只保留本次运行的有界内存，不新增上下文日志文件。重启前按需人工核对，不能将调试窗当永久审计。AI 回复现在逐条确认，启用 AI 不等于自动发送；操作和故障状态见 RUNTIME_LOGS.md。候选发送不确定先核对平台，不要盲目重发。

## 环境

Windows + Node.js >=24 + npm；依赖版本以 package-lock.json 为准，云端使用 Node 24。不要随意执行全量大版本升级。Electron 运行时版本仍沿用原工程 33.4.11，生产发布前必须安排运行时支持与安全升级评估。Go/Bun 仅为独立服务端构建所需，见 server/README.md。

本轮本机验证环境：Windows、Node.js 26.7.0、npm 11.19.0。其他环境安装后先运行类型、构建和桌面验收，不要假定已验证兼容。

开发服务器固定 `http://127.0.0.1:5173`；端口被占用时先停止占用本项目端口的服务，不要擅自更改来源验证。`VITE_DEV_SERVER_URL` 仅用于本地桌面开发，生产启动不要设置。

## 安装与构建

推荐 `npm ci` 恢复锁定依赖。Electron 二进制下载失败时，检查代理与 npm 下载日志，再重试该依赖安装；不要下载来源不明的运行时或手工修改 node_modules 作为长期方案。Vite 和 Electron 构建分别输出 dist、dist-electron，均可重新生成。

运行 `npm start` 启动本地桌面；`npm run dev` 只启动浏览器预览；`npm run electron:dev` 自动等待开发服务器后启动桌面。

## 配置、日志和测试产物

桌面数据在 app.getPath('userData')/local-runtime，Key 与托管会话由主进程系统加密保存；来源与账号隔离见 LOCAL_INTEGRATION.md、MANAGED_SERVICE.md。本机独立服务的数据、管理员启动凭据与主密钥在 server/runtime/local-http，日志为该目录 stdout.log/stderr.log。不要打印凭据，不把 Key 写入 VITE\_\*，不将运行数据和日志提交源码。数据库与主密钥需一起备份；本轮整理不迁移、重置或删除数据。

- 开发错误：启动终端和 DevTools；渲染错误缓存在 window.\_\_vueErrors（最多 50 条），供本地诊断使用。
- 桌面验收：artifacts/desktop/report.json 和逐路由 PNG。
- 改造前源码与清单：artifacts/baseline；这些是本机忽略产物，应自行保留备份，不能代替版本管理。

## 故障排查

内存紧张时避免把原生管理网页构建与桌面验收并行运行。桌面工具默认总截止仍为 180 秒；可在单次本机检查子进程中设置 LINGTU_DESKTOP_TIMEOUT_MS（180000～600000 毫秒），为实际窗口启动和整套检查留出有界时间，不改变单项断言、模型时限或生产行为。不要把截止较长误记为产品性能已验收；具体使用值与结果写入 VALIDATION.md。

| 现象               | 检查                                                               |
| ------------------ | ------------------------------------------------------------------ |
| 桌面空白           | 重新 npm run build，确认 dist 与 dist-electron 都存在              |
| 开发桌面无法加载   | 确认 5173 服务和 VITE_DEV_SERVER_URL 完全一致                      |
| 窗口按钮无效       | 确认在 Electron 运行，检查 preload 构建和 IPC 来源校验             |
| 页面出现未接入提示 | 查 HANDOFF 能力表；部分业务尚未接入；先查 LOCAL_INTEGRATION 能力表 |
| 修改组件后样式丢失 | 检查原 data-v 属性与 legacy 样式是否仍匹配                         |
| 桌面验收失败       | 查看 report.json 的具体路由和断言，不仅查看截图是否生成            |

## 云端与独立服务端

云端构建配置已收回 .github/workflows/lingtu-ai-desktop.yml，默认只生成 Actions Artifacts，不发布 Release。用户已授权本轮推送与 main 合并，将以对应 PR 的云端检查核对交付；构建、打包和下载说明见 PACKAGING.md。旧发布和撤回记录保存在 RELEASE_20261114.md，不作为当前待推送方案。

本机 HTTP 服务启动：npm run server:start；管理入口 http://127.0.0.1:3000/lingtu/admin，仅监听回环。不要在文档中记录实际账号密码；凭据来源和重复启动行为见 server/README.md。server/.upstream 和 bin 可重建，runtime 是私有数据，不能当作缓存清理。保留用户已有运行服务，不为整理目录而重启。

客户端安装包构建入口和打包后验收已实现；代码签名、自动更新、生产服务部署、恢复演练和告警未交付，不得按已完成操作。
