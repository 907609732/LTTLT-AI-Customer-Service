# 主项目目录与文件边界

当前实际主项目根目录为 E:\~1awucheng\Plastic SCM\AI电商客服软件\client。所有相对路径和npm命令均从这里计算，package.json与.github位于仓库根。当前基线与任务结果见HANDOFF.md。

## 源码与维护文件

```text
client/
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
5. 领域修改再读对应模块README与docs/parallel中的契约。

VALIDATION.md、DECISIONS.md按日期保留验证与决策；已完成的迁移、还原、旧发布和实施计划从Git历史查阅。

## 当前整理范围

产品名称为“灵兔 AI”，内部数据标识按BRANDING.md保持兼容。当前清理只移出过期文档和可重建产物，保留源码、依赖、许可、领域契约及私有运行资料。历史迁移过程从Git历史查阅；当前源码验收与清理结果见HANDOFF.md。
