# 主项目目录与文件边界

唯一主项目根目录为 F:\Setupgod\yunduo-ui。所有相对路径和 npm 命令均从这里计算。未来提交的项目内容从本目录开始，package.json 与 .github 应位于仓库根，不再嵌入旧 React 仓库。目标仓库和交付分支已按用户最新指令确定，见 MAIN_DELIVERY_20261114.md。

## 源码与维护文件

```text
yunduo-ui/
├─ .github/                 云端工作流与说明
├─ src/                     Vue 页面、模块、共享契约、样式
├─ public/                  前端静态资源
├─ electron/                主进程、preload、本地服务与平台适配
├─ server/                  独立 Go 服务端、原生管理网页覆盖层与运维入口
├─ vendor/lingtu-runtime/   客户端实际依赖的固定运行时与许可
├─ scripts/                 构建、边界检查与验收工具
├─ tests/                   客户端单元与交互测试
├─ docs/                    项目约束、架构、运维、交接和历史记录
├─ AGENTS.md                AI 维护入口
├─ README.md                项目入口与启动命令
├─ package.json             命令和依赖声明
├─ package-lock.json        固定依赖版本
└─ 其余根配置               TypeScript、Vite、ESLint、格式、打包、忽略规则
```

server 内的 overlay、patches.json、upstream.lock.json、scripts、tests、来源和许可文件属于可维护源码。vendor 是实际运行依赖，不能当作缓存删除。客户端与服务端独立构建，桌面安装包不内嵌 Go 服务或管理员账户。

## 生成文件与私有数据

| 路径                           | 用途                               | 提交要求                               |
| ------------------------------ | ---------------------------------- | -------------------------------------- |
| node_modules/                  | npm 安装的依赖                     | 不提交，可用 npm ci 重建               |
| dist/、dist-electron/          | 网页与桌面构建产物                 | 不提交，可重建                         |
| release/                       | 安装程序、ZIP、本机下载产物        | 不提交 Git，发布另行授权               |
| artifacts/、coverage/          | 检查日志、截图、临时备份、覆盖率   | 不提交，保留现场供核对                 |
| server/.upstream/              | 固定上游生成源码与管理网页产物     | 不提交，可按锁重新准备                 |
| server/bin/、server/artifacts/ | 服务端程序和验证证据               | 不提交 Git                             |
| server/runtime/                | 本机数据库、密钥、凭据、浏览器资料 | 私有运行数据，不提交、不随意删除或移动 |

桌面日常数据仍在 app.getPath('userData')/local-runtime；详情见 LOCAL_INTEGRATION.md。整理目录不迁移、重置或覆盖这些数据。

## 项目外的目录

F:\Setupgod 下的 \_github、managed-admin-real-ui-20261113、customer-service-phrases、外层 desk-v1 等属于其他仓库、参考资料或历史工作区。当前运行与构建入口引用本工程内的 vendor 和 server，不以这些兄弟目录作为项目源码。它们本轮全部保留原样，不复制进本项目、不删除、不移动。

## 文档阅读顺序

1. README.md 与本文：确认项目根、目录与运行入口。
2. AGENTS.md、CONSTRAINTS.md、ARCHITECTURE.md：开发约束和依赖边界。
3. HANDOFF.md、LOCAL_INTEGRATION.md、MANAGED_SERVICE.md：当前能力与数据范围。
4. OPERATIONS.md、PACKAGING.md、server/README.md：本机运维、云端构建和独立服务。
5. MERGE_GUIDE.md：仅在将功能移植到其他项目时参考。

VALIDATION.md、DECISIONS.md 按日期保留验证与决策；RESTORATION.md、RELEASE_20261114.md 为历史记录，不能当作当前生成、发布或推送指令。

## 当前整理范围

后续已按用户要求同步改名为“灵兔 AI”，包含产品显示、npm 包名、窗口/网页、打包与云端产物、后台和当前文档。主目录仍为本文件所列路径，内部数据标识按 BRANDING.md 保留兼容。旧生成文件和历史发布记录不重写，本轮允许按 MAIN_DELIVERY_20261114.md 建立交付分支并合并 main，公开发布仍须另行授权。

初次目录整理只涉及云端配置和维护文档，后续品牌改名已扩展到客户端、后台、图片、npm 名称和打包配置；代码目录、持久化兼容标识、依赖、运行数据及其他文件夹继续保留。用户现已明确授权建立交付分支并进入 main，本目录已初始化 Git 并关联约定仓库；交付按 MAIN_DELIVERY_20261114.md 执行，结果以对应 PR 与云端记录为准。
