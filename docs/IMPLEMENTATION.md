# Figma 可编辑设计重构 — 实施记录

## 源设计已解析

- 采用原始 `.fig` 的 `我们的设计方案` Canvas（ID 2:129），不采用 `原软件` Canvas 中的参考截图。
- 本地离线提取共 3,351 节点、146 个 Figma Symbol、907 实例、32 个 UX 画板根节点和 149 个引用图片资源。
- `docs/figma-map.json` 中全部 32 个画板有真实 Node ID、尺寸和 SHA 来源，`visualVerified=false`，待与 Figma 原画板逐项核对。
- `src/design/generated/components.json` 存放 116 个通用 Symbol，运行时按 `symbolData.symbolID` 复用层级。PNG 截图不参与界面渲染。

## 已删除旧前端

原 `src/App.tsx`、旧 Sidebar/Topbar/Modal、旧 Home/Dashboard/ConfigDetail/Welcome/Design 页面、旧 CSS、参考平台图片和旧版截图均已清理，重新建立新的设计渲染工程。重构分支为 `feature/figma-editable-rebuild`，备份分支为 `backup/pre-figma-rebuild-20261107`。

## 第一版可操作内容

- 32 个可编辑页面按真实图层 JSON 懒加载，可搜索/切换，支持缩放和折叠索引。
- 已依据真实 Figma 源节点配置首页导航（UX01 → UX04/UX26）、未登录店铺及添加店铺入口。
- 设计节点的尺寸、位置、文字、填充色、渐变、图片、圆角、模糊、阴影与基础复用组件可以由原始数据绘制。
- Electron 原生安全进程、IPC 桥接和本地运行保留，未连接真实电商平台。

## 未完成与验收门槛

1. 复杂矢量图形的 SVG 准确还原和实例属性覆盖，避免以默认方块替代图标。
2. 把 Figma 中的通用组件收敛为可维护的 React Topbar/Sidebar/Button/Dialog/Table，并接入真正的组件变体与状态。
3. UX04–UX06、UX08–UX10、UX12–UX13 按 UX 文档组合为三个可滚动长页（避免重复头部）。
4. 使用 Figma 导出的对应页面 PNG，与 Electron 同尺寸截图对比进行像素级验收；当前尚未完成。
5. 业务接口、权限、持久化、工单、模型、消息发送等按 UX 文档逐项开发，未获授权前禁止真实平台操作。

## 数据保护

`design/snapshots` 包含完整私有设计数据，仅保留 Windows 本地并被 Git 忽略。`src/design/generated` 仅包含用于客户端的屏幕结构化数据与组件定义。请保持 GitHub 仓库为私有；发布成开源仓库之前需要另外审查图片和设计文案。
