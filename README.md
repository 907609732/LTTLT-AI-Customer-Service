# 灵兔 AI 电商客服

按最新 Figma 右侧可编辑画板实现的 Electron＋React 前端。正式入口直接显示产品界面；画板索引放在独立验收入口。

- 桌面 UX01—25：1440×900；辅助侧栏 UX26—32：300×900。
- 保留三条长页、原生图层/矢量、组件状态、菜单与浮层；提供真实输入和前端草稿管理。
- v0.3.0已接入desk-v1本地后端：拼多多网页版、抖店客户端接入、消息采集、人工回复、AI开关和模型/转人工关键词配置。AI每次启动默认关闭。
- 工单、质检、订单、意图知识库、定时调度等仍未接入；浏览器入口保留离线设计演示。完整范围和真平台验收边界见[接线说明](docs/INTEGRATION.md)。
- 当前开发分支的最终视觉、桌面窗口与云端产物验收以交接报告为准，不将结构检查当作所有业务已完成。

## 本地预览

Node.js >=22.12（当前验证24）：

```powershell
npm ci
npm run dev
```

浏览器预览使用 `npm run dev:web`；产品首页为 `/`，设计验收入口为 `/?design=1`，单页复核可用 `/?screen=UX11`。

## GitHub 云端构建

正式构建、Windows打包、浏览器和Electron检查在 GitHub Actions 的 **Build and verify Electron frontend** 工作流执行。PR更新和main提交会触发，亦可手动运行。通过后下载 `lingtu-windows-frontend-<提交SHA>`，运行其中的 `LingtuCustomerService.exe`。

[前端交接与后端接入点](docs/FRONTEND_HANDOFF.md)说明代码结构、服务接口、启动方式、数据边界和验收状态。[Figma页面映射](docs/figma-map.json)记录当前来源、尺寸及逐页视觉状态。

## 设计来源与本地同步

只使用 Figma文件 `CR9QYrjZfTfMf6CIBj5yrb` 中 `我们的设计方案` Canvas（2:129）的可编辑结构，左侧参考图不用于铺成页面背景。当前结构由已有本地插件的 JSON_REST_V1 读取，不消耗Figma MCP额度。

当前本地快照预处理：`npm run design:prepare -- --current design/snapshots/<目录>/current.json`。原始 `.fig`、完整快照、真实店铺凭据和顾客数据不得提交；`design/snapshots` 已被Git忽略。

## 许可证与商业授权

本项目原创代码及随附项目文档采用 **[GNU AGPL v3 only（AGPL-3.0-only）](LICENSE)**。分发及修改版本的网络服务须按许可证履行相应的版权保留、同许可及对应源代码提供义务。

**遵守 AGPL 的商业使用无需另购商业授权。** 需要不同于 AGPL 条件的闭源交付、指定 SaaS、OEM 或其他商业权利时，可向有权授权的项目权利人申请单独许可；以双方明确签署并生效的授权订单为准。

- [完整开源许可证](LICENSE)
- [许可适用范围与使用说明](LICENSING.md)
- [商业授权协议框架（须另行签署）](COMMERCIAL_LICENSE.md)
- [贡献与再许可规则](CONTRIBUTING.md)
- [第三方内容与权利说明](THIRD_PARTY_NOTICES.md)

第三方依赖、素材和商标继续适用各自条款，商业协议不豁免其义务。商业授权意向可在[本仓库 Issues](https://github.com/907609732/LTTLT-AI-Customer-Service/issues) 中提出。

## 开发分支

- [Figma 可编辑画板重构](https://github.com/907609732/LTTLT-AI-Customer-Service/tree/feature/figma-editable-rebuild)
- [早期 Electron 客户端基础](https://github.com/907609732/LTTLT-AI-Customer-Service/tree/feature/local-electron-foundation)
