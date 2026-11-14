<div align="center">

# 灵兔 AI

**让店铺知识融入每一次回复，让客服接待更有条理。**

面向电商客服的 Windows 桌面工作台，集中管理店铺、商品知识、AI 回复与接待记录。

[![Windows build](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/workflows/lingtu-ai-desktop.yml/badge.svg?branch=main)](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/workflows/lingtu-ai-desktop.yml)
![Windows x64](https://img.shields.io/badge/Windows-x64-0078D4)
![Vue 3](https://img.shields.io/badge/Vue-3-42b883)
![Electron](https://img.shields.io/badge/Electron-43-47848f)
[![License](https://img.shields.io/badge/License-AGPL--3.0--only-blue)](LICENSE)

**[构建与下载](docs/PACKAGING.md)** · [快速开始](#快速使用) · [开发文档](docs/DEVELOPMENT.md) · [问题反馈](https://github.com/907609732/LTTLT-AI-Customer-Service/issues)

</div>

---

|     管理店铺     |         整理知识         |         辅助接待         |
| :--------------: | :----------------------: | :----------------------: |
| 选择店铺与工作区 | 维护商品、意图与回复规则 | 生成候选回复，确认后发送 |

[主要功能](#主要功能) · [接入与当前状态](#接入与当前状态) · [快速使用](#快速使用) · [数据说明](#数据与网络连接) · [源码运行](#从源码运行)

## 构建与下载

当前 Windows x64 安装包与 ZIP 通过 [GitHub Actions](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/workflows/lingtu-ai-desktop.yml) 构建，保存在对应运行记录的 **Artifacts** 中，保留 30 天。下载需要具备仓库访问权限并登录 GitHub；过期产物需重新构建。

具体下载、校验与启动步骤见[打包与成品验收](docs/PACKAGING.md)。Actions 构建产物不代表已发布正式版本，GitHub 的 Source code ZIP 是源码，不是安装包。

## 主要功能

| 能力              | 你可以做什么                                                                    |
| ----------------- | ------------------------------------------------------------------------------- |
| 🏪 店铺管理       | 管理本机店铺、分组与平台窗口，按店铺控制 AI 开关。                              |
| 📚 商品与意图知识 | 维护商品资料、多问答、关键词及绑定规则，预览导入并导出知识。                    |
| ⚙️ 模型与回复规则 | 配置自己的模型 Key 和兼容接口，测试连接，按店铺绑定规则；也可显式选择托管服务。 |
| 💬 辅助回复       | 结合店铺知识生成候选回复，逐条确认后发送；查看会话、保存草稿与人工接管。        |
| 🖼️ 图片识别       | 使用当前配置的多模态模型，按店铺开启识图并在训练场验证。                        |
| 🧩 运营辅助       | 使用快捷回复、跨店同步与回滚、持久化定时任务及本机事件日报。                    |
| 📋 工单与质检     | 登记本机工单、记录跟进状态，审核纠错知识。                                      |
| 🧪 模拟演练       | 在本机模拟店铺和顾客页中验证消息、模型请求与发送确认流程。                      |

以上为当前已接线的能力概览，实际接入范围、验证结果和缺口见[当前状态](docs/HANDOFF.md)及[整合记录](docs/parallel/INTEGRATION.md)。

## 接入与当前状态

| 入口或能力     | 当前说明                                                             |
| -------------- | -------------------------------------------------------------------- |
| Windows 桌面端 | 主要运行入口，连接本机业务服务与平台适配器。                         |
| 浏览器预览     | 用于界面预览，不具备完整桌面接待能力。                               |
| 拼多多辅助中心 | 已有平台接入与部分实店只读核对；非空售后及多页工单仍待样本验收。     |
| 自带模型 Key   | 默认模式，需自行配置模型接口和凭证。                                 |
| 托管服务       | 可显式选择；团队与调用次数计费已有接线，真实充值支付仍待接通和验收。 |

平台主动自动学习、无消息访客欢迎、图片/视频欢迎、催付和平台客服自动转接仍未接入。看板基于有界的本机采集记录，不能代替完整订单与营收报表。更多平台及真实模型效果需分别验收。

## 快速使用

1. 按[构建与下载](#构建与下载)取得桌面产物，或按下文从源码启动。
2. 在模型设置中配置服务商、接口与模型 Key，测试连接；使用托管模式时先配置相应服务账号。
3. 添加店铺，在平台官方页面完成登录，选择需要维护的店铺。
4. 整理商品、意图知识与回复规则，先通过训练场或本机模拟店铺检查效果。
5. 开启对应店铺 AI，核对生成的候选回复，逐条确认后发送。

每次启动时 AI 默认关闭。启用 AI 不等于批准发送；发送结果不确定时，应先核对平台会话。

## 数据与网络连接

默认桌面数据保存在 `%APPDATA%/yunduo-ui-restored/local-runtime`，保留旧目录以兼容已有资料与登录状态。托管模式按服务来源和已验证账号隔离工作区，详见[本地接入](docs/LOCAL_INTEGRATION.md)与[托管服务](docs/MANAGED_SERVICE.md)。

模型 Key 由 Electron 主进程通过系统加密保存。生成回复和图片识别时，相关上下文会发送至所选模型服务；平台接入需要连接对应电商平台，托管模式还会连接配置的托管后端。

提交问题时请附复现步骤及脱敏日志，不要上传模型 Key、令牌、Cookie、买家资料或本机业务数据目录。日志和逐条发送确认机制见[运行日志说明](docs/RUNTIME_LOGS.md)。

## 从源码运行

技术栈：Vue 3、TypeScript、Electron、Vite、Pinia、Element Plus。以下命令在 Windows PowerShell 中执行，先安装 Git、Node.js 24 及 npm。

```powershell
git clone https://github.com/907609732/LTTLT-AI-Customer-Service.git
cd LTTLT-AI-Customer-Service
npm.cmd ci
npm.cmd start
```

已取得源码时，进入包含 `package.json` 的仓库根目录执行命令。首次安装或锁文件变化后运行 `npm.cmd ci`；依赖就绪时直接启动。

| 命令                       | 用途                           |
| -------------------------- | ------------------------------ |
| `npm.cmd start`            | 构建并启动桌面应用             |
| `npm.cmd run electron:dev` | 启动 Vite 与 Electron 开发模式 |
| `npm.cmd run dev`          | 启动浏览器预览                 |
| `npm.cmd run build`        | 构建网页与桌面源码             |

日常修改仅验证直接影响的流程；Release 打包时执行全量检查和成品验收，具体规则见 [AGENTS.md](AGENTS.md)。独立服务端位于 `server/`，环境和启动方法见[服务端说明](server/README.md)。

## 开发文档

| 文档                                                                     | 用途                                   |
| ------------------------------------------------------------------------ | -------------------------------------- |
| [当前状态](docs/HANDOFF.md)                                              | 当前基线、验证证据、功能缺口及后续验收 |
| [开发规则](AGENTS.md)                                                    | 修改边界与验证要求                     |
| [目录说明](docs/PROJECT_LAYOUT.md)                                       | 源码、生成文件与私有数据边界           |
| [项目约束](docs/CONSTRAINTS.md) / [架构](docs/ARCHITECTURE.md)           | 模块依赖、接口与数据流                 |
| [开发说明](docs/DEVELOPMENT.md) / [本地运维](docs/OPERATIONS.md)         | 功能接入、运行环境与故障排查           |
| [打包说明](docs/PACKAGING.md) / [云端构建](.github/README.md)            | Actions 产物、校验与成品验收           |
| [辅助中心](docs/ASSIST_CENTER.md) / [辅助浏览器](docs/ASSIST_BROWSER.md) | 平台窗口与辅助业务接入                 |

## 许可与第三方来源

项目许可见 [LICENSE](LICENSE)，适用范围及单独商业授权说明见 [LICENSING.md](LICENSING.md)。第三方代码与素材按其自身条款使用，来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

BY 五成
