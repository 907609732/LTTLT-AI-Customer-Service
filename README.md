# 灵兔 AI 电商客服 · Electron 客户端

![本地前端首页预览](docs/preview-home.png)

> v0.1.0 本地前端预览。此工程独立于 Figma MCP、ChatGPT Figma 连接器；**没有接入电商平台，也没有发送真实消息的能力**。

## 已有功能

Electron + React + TypeScript + Vite；店铺首页、公共顶部栏/侧栏、配置导航、看板空状态、本地演示店铺管理、进店欢迎语编辑/保存/恢复、离开草稿确认、Figma 设计快照导入（只读）。另外建立 UX01–UX32 路由索引；大部分业务页目前仍为待实现占位页面。

## 本地运行（Windows）

要求 Node.js 22.12+。

```powershell
npm install
npm run build
npm start
```

也可直接双击 `start-preview.cmd`（首次需要安装依赖）。开发热更新用 `npm run dev`。

如果 Electron npm 包存在但 `node_modules/electron/dist/electron.exe` 缺失，可以运行：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node .\node_modules\electron\install.js
```

## 验证

```powershell
npm run typecheck
npm test
npm run build
```

端到端测试默认使用 Playwright 自带 Chromium；如未安装，可以在本机临时指定 Chrome：

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE="C:\Program Files\Google\Chrome\Application\chrome.exe"
npm run test:e2e
```

## Figma 不占 MCP 额度的交付流程

1. Figma 桌面端打开目标文件，在 **Plugins → Development → Import plugin from manifest** 导入 `plugins/figma-local-export/manifest.json`。如 Figma 要求有效插件 ID，先通过 Figma 的 Create new plugin 获取开发 ID，再更新本地 manifest。
2. 运行「灵兔 · 本地设计交付」，选中正式画板，点击导出，并保存 `lingtu-design-*.json`。可以拆批次导出 1–20 个节点，不建议超过 20 MB。
3. 在客户端「本地设计交付」页导入 JSON，预览画板与节点数据；或使用 `npm run design:import -- "路径\快照.json"` 将画板结构和 PNG 预览保存到 `design/snapshots/`。
4. 按 `docs/figma-map.json` 为 UX 编号建立本地设计节点 ID，逐个实现 React 页面和交互，复用顶部栏/侧栏，不直接使用截图充当交互界面。
5. 图片素材、图标 SVG 要从 Figma 另行导出；JSON 中的 PNG 是用于对比的预览图。

这个插件为**本地只读导出**，不调用云端 API、不需要 Figma MCP 或 ChatGPT 连接器额度；但仍需能正常打开 Figma 文件。它不具备批量修改 Figma 画板、双向实时同步能力。原始 `.fig` 文件不能直接导入本客户端。

## 设计与 UX

- 设计关联：`docs/figma-map.json`（32 个 UX 号；尚无正式节点 ID）
- 产品功能定义：`docs/IMPLEMENTATION.md`
- 平台示意图标：`public/assets`（来源于已有离线 HTML 前端原型）
- 历史参考：本机下载目录 `AI客服-可编辑图层.fig`；不是已解析的工程数据

## 安全边界

仅演示本地数据；没有联网登录店铺/真实 AI 回复。Electron 的 Renderer 关闭 Node 集成，启用 contextIsolation 和 sandbox；preload 只暴露允许的 IPC 方法。店铺 Token、客户信息、密钥及设计原始文件不要提交到 Git。
