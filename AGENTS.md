# Agent 开发规则 — 灵兔 AI 电商客服

1. 只依据 `AI客服-可编辑图层.fig` 的 **我们的设计方案** Canvas 和 `docs/figma-map.json` 开发视觉，不允许使用 `原软件` Canvas 的图片参考代替可编辑图层。
2. 不复用旧版 Home/Dashboard/Sidebar/Topbar/ConfigDetail 组件；旧版仅保存在历史备份分支以便必要时参考非视觉业务行为。
3. 设计同步流程：`npm run design:decode -- path/to/file.fig` → `npm run design:prepare` → 检查 `src/design/generated/screens`、`components.json` 和 `figma-map.json`。
4. 保持图层 ID、组件 ID、宽高、位置、字体、填充、渐变、边框、圆角、阴影、Auto Layout（待支持）与原始可编辑设计对应。PNG 只作视觉验收，不许铺成页面背景。
5. 复用 Figma Symbol/Instance，未来业务页面应逐步形成真正可维护的 React 组件，而不复制多个外观相同的组件。
6. 离线的 `.fig` 解码工具是第三方社区库，不承诺支持所有新版格式，解析失败时先检查兼容性，不要暗中降级为参考图猜测。
7. `UX05/06`、`UX09/10`、`UX13` 分别是三个长页的续段，正式业务 UI 需合并内容而不是简单重复页面。
8. 真实店铺登录、批量操作、AI 回复、订单处理必须单独实现和经授权验证；目前全部处于未接入状态。
9. 禁止提交任何账号凭据、用户聊天数据、完整设计快照或原始 `.fig`。若部署开源，先审查所有 Figma 生成图片及文字。
10. 每次修改执行 `npm run typecheck`、`npm test`、`npm run build`，涉及画板或路由需执行 `npm run test:e2e`。
11. 功能分支提交，禁止直接覆盖 `main`。没有完成真实 Figma 视觉验收的页面不得标记为设计完成。
