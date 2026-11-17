<div align="center">

<img src="src/assets/lingtu-ai-icon.png" width="88" alt="灵兔AI电商客服" />

# 灵兔AI电商客服

**让店铺知识融入每一次回复，让客服接待更有条理。**

面向电商客服的 Windows 桌面工作台，集中管理店铺、商品知识、AI 回复与接待记录。

[![Release v1.0.48](https://img.shields.io/badge/Release-v1.0.48-0071e3)](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.48)
[![Windows build](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/workflows/lingtu-ai-desktop.yml/badge.svg?branch=main)](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/workflows/lingtu-ai-desktop.yml)
![Windows x64](https://img.shields.io/badge/Windows-x64-0078D4)
![Electron](https://img.shields.io/badge/Electron-43-47848f)
[![License: Apache-2.0 (owner code)](<https://img.shields.io/badge/License-Apache--2.0%20(owner%20code)-blue>)](LICENSE)
![License: mixed](https://img.shields.io/badge/License-Mixed-lightgrey)

**[下载 Windows 安装包](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.48/LingtuAI-Setup-1.0.48-win-x64.exe)** · [下载 ZIP 便携版](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.48/LingtuAI-1.0.48-win-x64.zip) · [v1.0.48 发布页](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.48) · [问题反馈](https://github.com/907609732/LTTLT-AI-Customer-Service/issues)

</div>

> [!IMPORTANT] > **许可范围：本仓库是混合许可项目，不是整体 Apache-2.0。** 根 [LICENSE](LICENSE) 的 Apache-2.0 仅覆盖 [许可范围矩阵](docs/legal/LICENSE_SCOPE.md) 列明、由权利人拥有且有权重新许可的原创代码和文档。`server/` 的 New API 派生部分适用 [AGPL-3.0-or-later](https://github.com/QuantumNous/new-api)，`vendor/lingtu-runtime/` 适用 [AGPL-3.0-only](vendor/lingtu-runtime/LICENSE)（[上游来源 PR #18](https://github.com/907609732/LTTLT-AI-Customer-Service/pull/18)）；第三方依赖、字体、图片、平台商标、历史还原素材和权属未确认的外部贡献不纳入 Apache-2.0。含 AGPL 组件的组合程序仍须按相应许可证履行源码等义务；对应源码与修改记录见[本仓库](https://github.com/907609732/LTTLT-AI-Customer-Service)。本项目不声称整个应用已可闭源交付或已完成普遍合规认证。

---

|         管理店铺         |         整理知识         |         辅助接待         |
| :----------------------: | :----------------------: | :----------------------: |
| 登录平台，配置模型与店铺 | 维护商品、意图与回复规则 | 生成候选回复，确认后发送 |

[主要功能](#主要功能) · [平台接入](#平台与接入方式) · [快速使用](#快速使用) · [数据说明](#数据与网络连接) · [源码运行](#从源码运行)

## 下载安装

当前公开版本：**v1.0.48**。Windows x64 可直接下载[安装程序](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.48/LingtuAI-Setup-1.0.48-win-x64.exe)或 [ZIP 便携版](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.48/LingtuAI-1.0.48-win-x64.zip)，并使用同一发布页的 [SHA256SUMS.txt](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.48/SHA256SUMS.txt) 校验。

安装包未做代码签名，需要手动下载安装。v1.0.48 对应确切源码 `12b31cae66e6d9d1b4e0db3cfa7b3ac0448b546f`，已包含闲鱼接入、共用本机工作区及知识库工具栏分组。托管双模型路由属于独立服务端功能，需单独部署并保存管理员策略；本次 Windows 发布不部署生产服务端。GitHub 的 Source code ZIP 是源码，不是安装包。

发布范围、确切源码和验证边界见 [v1.0.48 发布验收](docs/RELEASE_V1.0.48.md)。

## 主要功能

以下按 v1.0.48 说明；独立托管服务端不包含在 Windows 安装包内。

| 能力              | 你可以做什么                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------- |
| 🏪 店铺与平台     | 添加、分组和打开店铺，单独开关各店 AI；通过基础设置引导完成平台登录、资料配置和接待试答。   |
| 📚 商品与意图知识 | 采集拼多多平台商品详情与 SKU，读取平台商家编码和条形码来源；维护问答及按规格检索知识。      |
| 🧠 学习与审核     | 商品卡片显示内联学习进度；学习、人工审核和启用相互独立。知识库工具栏自 1.0.38 起分组展开。  |
| ⚙️ 模型与回复规则 | 配置自己的模型 Key 和兼容接口，测试连接，按店铺绑定规则；也可显式选择托管服务。             |
| 💬 AI 辅助回复    | 结合店铺知识生成候选；默认审核发送，可按店显式选择自动发送。启用 AI 不等于批准单条回复。    |
| 🪵 回复监控与日志 | 查看待确认与发送状态；详细日志支持清除、置顶/取消置顶和原生拖动，清除保留待确认及活动请求。 |
| 🧩 运营与演练     | 使用内置快捷话术、本机数据看板、工单与质检，以及本机模拟店铺和顾客页演练。                  |

一位买家的回复等待审核时，其他买家仍可继续定位和生成；同一买家保持独占，确认门和消息复核规则不变。

进店欢迎文字仍与首次 AI 正文合并批准；欢迎延迟默认 1～3 秒随机，可按店铺配置 1～3600 整数秒范围（下限不大于上限，相等即固定）。只有实际附加了欢迎文字的候选才在批准后等待，普通回复、图片/视频和独立访客规则不受影响。

## 平台与接入方式

| 平台         | 当前接入                                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 拼多多       | 平台商品、历史会话和指定日期订单已做部分实店只读核对；商品详情、聊天学习和订单采集已接线。                                                   |
| 闲鱼网页版   | 自 1.0.39 起接入，已包含在当前安装包中。只采样当前打开/待回复会话，不监听未打开会话、不采集商品、不发送视频；文字/图片发送仍待真实买家验收。 |
| 本机模拟店铺 | 在本机模拟店铺、客服台和顾客页验证消息、模型请求与发送确认流程，不连接真实平台，也不代表平台已送达。                                         |

拼多多的真实欢迎、发送、转接、催付及支付仍待业务样本验收；订单来源缺少的退款或时间字段保持未知，不将实收合计视为净营收。当前安装包已包含闲鱼接入和共用本机工作区。侧栏“导入知识”会打开知识库，“店铺设置”仍是未接入提示。

## 快速使用

1. 按[下载安装](#下载安装)取得 v1.0.48，或按[从源码运行](#从源码运行)启动当前 `main`。
2. 通过顶部“登录”入口选择本机 Key 或托管账号，并在配置中心完成模型接口、凭证与回复规则配置；保存前先测试连接。
3. 添加店铺，按自动弹出的基础设置引导完成平台登录、资料配置和接待试答；也可右键店铺重新打开引导。
4. 在知识库导入或维护商品与问答资料，完成学习后显式审核、启用；需要演练时使用训练场或本机模拟店铺。
5. 确认平台登录身份后再开启对应店铺 AI，核对候选并按店铺模式处理。训练场和模拟演练不会触发真实买家发送。

店铺 AI 的显式开启选择会被记住；正常启动或登录后，只有当前平台店铺与客服身份重新核验一致才会恢复。没有有效记录或记录损坏时保持关闭，旧候选、旧批准和待发送任务不会恢复。

## 数据与网络连接

当前版本把本机模式与所有托管账号统一到同一个本机 `local-runtime` 业务目录和 `yunduo-local` 平台分区。旧 `managed-workspaces/` 目录保留在磁盘上，但不再读取或自动合并，没有自动迁移；同一台机器上的不同托管账号会看到同一份本机店铺、会话、知识、工单和平台登录态。

模型 Key 由 Electron 主进程通过系统加密保存。生成回复和图片识别时，相关上下文会发送至所选模型服务；平台接入需要连接对应电商平台，托管模式还会连接配置的托管后端。日志只保留本次运行的有界内存记录，不记录 HTTP 头、API Key 或服务商完整错误响应。

提交问题时请附版本、平台、复现步骤及脱敏日志，不要上传模型 Key、令牌、Cookie、买家资料或本机业务数据目录。日志和逐条发送确认机制见[运行日志说明](docs/RUNTIME_LOGS.md)。

## 从源码运行

技术栈：Vue 3、TypeScript、Electron、Vite、Pinia、Element Plus。以下命令在 Windows PowerShell 中执行，建议使用 Node.js 24 与 npm，并先安装 Git。

```powershell
git clone https://github.com/907609732/LTTLT-AI-Customer-Service.git
cd LTTLT-AI-Customer-Service
npm.cmd ci
npm.cmd start
```

开发模式使用 `npm.cmd run electron:dev`；浏览器预览使用 `npm.cmd run dev`。日常修改只验证直接影响的流程，Release 打包时执行全量检查和成品验收。

更多说明见 [当前状态](docs/HANDOFF.md)、[目录说明](docs/PROJECT_LAYOUT.md)、[版本说明](docs/VERSIONING.md)、[架构](docs/ARCHITECTURE.md)、[AI 状态恢复](docs/AI_STATE_RESTORE.md)、[本地接入](docs/LOCAL_INTEGRATION.md)、[托管服务](docs/MANAGED_SERVICE.md)和[云端构建](.github/BUILDING.md)。

## 许可与第三方来源

根 [LICENSE](LICENSE) 是未经改写的 Apache License 2.0，但只适用于 [LICENSE_SCOPE.md](docs/legal/LICENSE_SCOPE.md) 明确列出的、由项目权利人拥有且有权重新许可的原创代码和文档。Apache-2.0 已授予的商业使用、修改、分发和闭源集成权利无需另行购买；企业部署、OEM/品牌和服务等级等额外合作见 [COMMERCIAL_LICENSE.md](docs/legal/COMMERCIAL_LICENSE.md)，该文件不是软件许可，也不限制 Apache 权利。

`server/` 的 New API 派生代码适用 [AGPL-3.0-or-later](https://github.com/QuantumNous/new-api)，`vendor/lingtu-runtime/` 适用 [AGPL-3.0-only](vendor/lingtu-runtime/LICENSE)（[PR #18](https://github.com/907609732/LTTLT-AI-Customer-Service/pull/18)），其来源、修改记录和许可文本保持原样。第三方依赖、字体、平台名称与图标、测试夹具、图片和引用素材遵循各自的许可证或权利声明。本次许可证变更不撤回此前版本中依 AGPL 或其他有效许可证已经授予的权利。业务数据与源码分离、私有目录不发布，并不免除 AGPL 等许可证要求的对应源码或安装材料义务。

完整边界见 [LICENSING.md](docs/legal/LICENSING.md)、[LICENSE_SCOPE.md](docs/legal/LICENSE_SCOPE.md) 和 [THIRD_PARTY_NOTICES.md](docs/legal/THIRD_PARTY_NOTICES.md)；闲鱼桥接脚本的来源、哈希与本维护副本的 Apache-2.0 许可见 [vendor/xianyu-bridge/PROVENANCE.md](vendor/xianyu-bridge/PROVENANCE.md)。本仓库的软件许可不改变第三方权利，也不表示获得相关平台的官方认可。

BY 五成
