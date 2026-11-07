# Codex / 本地代理工作约定

项目：灵兔 AI 电商客服（Windows Electron + React + TypeScript + Vite）。

## 最高优先级：Figma 可编辑画板优先

- **Figma 原生可编辑 Frame / Component 是唯一视觉设计源。** UX 文档只负责业务行为和验收，不负责猜测布局。
- 未导入对应的 Figma JSON_REST_V1 图层结构、组件/样式引用和正式画板 Node ID 前，不得把该 UX 页面标记为视觉完成，也不得凭参考截图、旧 HTML 或文字自行重画最终界面。
- PNG 预览只作像素对照；不得将截图直接铺成客户端背景，不得把截图当成可编辑结构。
- 每个页面开发前必须在 `docs/figma-map.json` 或本地生成映射中具备 `uxId`、`figmaNodeId`、`snapshotHash`、画板尺寸。缺少其中任何一项，先请求/导入设计快照，不猜测。
- 设计快照来源为 `plugins/figma-local-export/` 的本地 Classic Plugin。插件禁止网络访问，不使用 Figma MCP、ChatGPT Figma 连接器或 Figma REST API。
- Figma 插件 ID 必须由 Figma 的 **New Plugin** 流程生成；严禁编造 ID，严禁复用 NGR Figma UI 锻造台的 ID。
- UX05/06、UX09/10、UX13 是滚动续页，不要创建重复独立导航。以 UX 文档定义的页面合并关系为准。

## 代码与交互规则

- 复用 `Topbar`、`Sidebar`、Modal、设计变量和组件；不要复制相同导航控件。
- 切换店铺必须保持 `storeId` 上下文。表单采用 draft/saved 双状态并提供离开提示；保存失败保留草稿。
- 真实业务接口未接入前必须使用清晰标注的 Mock，不得伪造真实店铺状态。
- **未经单独实现及验证，禁止连接真实店铺、发送消息、修改订单或自动执行批量操作。**
- 不得提交密钥、真实客户数据、`.fig` 源文件或完整设计快照。设计快照默认保留本地。
- 设计还原验收：布局层级、宽高、Auto Layout、Constraints、字体、字号、行高、颜色、边框、圆角、阴影、图标、组件变体和滚动行为均与正式画板核对。
- 每次代码修改后至少执行 `npm run typecheck`、`npm test`、`npm run build`；必要时执行 `npm run test:e2e` 和 `npm run test:electron`。
- 推送到 feature 分支，禁止未经审查直接覆盖或合并 main。视觉未通过设计对照，不得宣称页面完成。
