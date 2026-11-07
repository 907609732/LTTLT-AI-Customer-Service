# Electron 前端实施状态

## 当前阶段：建立可编辑画板的无额度交付链路

**设计基线尚未导入。** 目前的首页、欢迎语及 UX08–UX19 是可运行的交互原型，部分依据旧 HTML 原型和 UX 交互文档实现；它们不是最终视觉稿，也未通过真实 Figma Frame 的像素/图层对照。不能把这些原型当成设计验收完成。

## 设计源规则

- 视觉唯一来源：Figma 原生可编辑 Frame / Component。
- 行为唯一来源：UX01–UX32 交互功能文档。
- PNG 仅作视觉对照，不可代替图层结构。
- 每页进入正式开发前必须导入对应 JSON_REST_V1 节点树、组件/样式引用、Figma Node ID 和快照 SHA-256。
- 未匹配到正式画板的页面继续保持待实现/原型状态，不根据截图猜测布局。

## 页面实施状态

| 范围 | 当前代码状态 | 正式视觉状态 |
| --- | --- | --- |
| UX01–UX04 首页/看板 | 第一版交互原型 | 等待可编辑画板导入 |
| UX05–UX06 看板续页 | 现有看板示例内容 | 等待可编辑画板导入 |
| UX07 店铺与商品 | 本地演示店铺管理 | 等待可编辑画板导入 |
| UX08–UX10 转接人工 | 本地配置交互原型 | 等待可编辑画板导入 |
| UX11 进店欢迎 | 本地编辑/保存/预览原型 | 等待可编辑画板导入 |
| UX12–UX19 配置页面 | 本地配置交互原型 | 等待可编辑画板导入 |
| UX20–UX23、UX25 | 保持待实现占位 | 必须先导入可编辑画板 |
| UX24 软件偏好 | 本地演示数据偏好 | 等待可编辑画板导入 |
| UX26–UX32 AI 辅助中心 | 导航与状态占位 | 必须先导入可编辑画板 |

## 本地 Figma 导出流程（不消耗 MCP / ChatGPT 连接器额度）

1. Figma Desktop → Plugins → Development → New Plugin...，创建一个独立空白开发插件，让 Figma 生成真实 numeric ID。不要使用 NGR 插件 ID。
2. 将新 ID 填入 `plugins/figma-local-export/manifest.json` 的 `id`，再用 Import new plugin from manifest 导入。
3. 在 Figma 文件中按 UX 编号选中真实 Frame / Component，运行「灵兔 · 可编辑画板交付」，导出 JSON。建议每批 1–5 个画板，文件上限 20 MB。
4. Electron「本地设计交付」导入快照；应用会将最近快照保存在 Electron userData。也可运行 `npm run design:import -- "快照.json"`，生成 `design/snapshots/<hash>/` 的本地结构文件和映射表。
5. 核对 UX 编号、Node ID、画板尺寸、子图层数量、组件和样式引用。未映射项先补映射，不能猜。
6. 根据正式画板实现 React 页面；用 PNG 仅作视觉对比，并以实际可编辑节点树还原组件和布局。

插件只读、不联网、不修改 Figma 文件；不使用 Figma MCP、ChatGPT Figma 连接器或 Figma REST API。原始 `.fig` 文件不直接解析。

## 代码结构

- `electron/main.cjs`、`electron/preload.cjs`：安全 Electron Shell
- `src/components/Topbar.tsx`、`Sidebar.tsx`：公共应用布局
- `src/pages/*`：客户端页面
- `shared/snapshot.mjs`：本地设计快照校验（v1/v2）
- `plugins/figma-local-export/`：只读导出插件
- `scripts/import-design.mjs`：快照导入、组件/样式拆分和 UX 映射
- `docs/figma-map.json`：UX 编号与待填 Figma Node ID

## 安全边界

仅演示本地数据；没有真实店铺登录、AI 模型回复或平台消息发送。Electron Renderer 关闭 Node 集成，启用 contextIsolation 和 sandbox，preload 只暴露允许的 IPC 方法。店铺 Token、客户信息、密钥和完整设计快照不得推送 Git。
