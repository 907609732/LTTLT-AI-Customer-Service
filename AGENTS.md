# Codex / 本地代理工作约定

项目：灵兔 AI 电商客服（Windows Electron + React + TS + Vite）。

- 不依赖 Figma MCP、ChatGPT Figma 连接器；优先读取本地 `design/snapshots/*/index.json` 与 `docs/figma-map.json`。
- 从正式设计快照逐页转换成 React UI，不得把截图直接放成主界面。必须复用 `Topbar`、`Sidebar`、Modal 和设计变量。
- UX05/06、UX09/10、UX13 是滚动续页，不要创建重复独立导航。详细映射见 `docs/figma-map.json`。
- 切换店铺必须保持 `storeId` 上下文。表单采用 draft/saved 双状态并提供离开提示；调用业务接口必须有 mock fallback。
- **未经单独实现及验证，禁止连接真实店铺、发送消息、修改订单或自动执行批量操作。**
- 不得提交密钥、真实客户数据、`.fig` 源文件或导出的完整设计快照。新设计改动限于指定 UX 页面，避免重绘其它功能。
- 每次代码修改后至少执行 `npm run typecheck`、`npm test`、`npm run build`；可用 Chrome 或 Chromium 运行 `npm run test:e2e`。
- 推送到 feature 分支，禁止未经审查直接覆盖或合并 main。当前阶段的设计还原程度必须如实标注。
