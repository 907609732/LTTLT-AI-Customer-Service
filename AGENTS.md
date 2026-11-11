# Agent 开发规则 — 灵兔 AI 电商客服

1. 只依据 `AI客服-可编辑图层.fig` 的 **我们的设计方案** Canvas 和 `docs/figma-map.json` 开发视觉，不允许使用 `原软件` Canvas 的图片参考代替可编辑图层。
2. 不复用旧版 Home/Dashboard/Sidebar/Topbar/ConfigDetail 组件；旧版仅保存在历史备份分支以便必要时参考非视觉业务行为。
3. 设计同步流程：`npm run design:decode -- path/to/file.fig` → `npm run design:prepare` → 检查 `src/design/generated/screens`、`components.json` 和 `figma-map.json`。
4. 保持图层 ID、组件 ID、宽高、位置、字体、填充、渐变、边框、圆角、阴影、Auto Layout（待支持）与原始可编辑设计对应。PNG 只作视觉验收，不许铺成页面背景。
5. 复用 Figma Symbol/Instance，未来业务页面应逐步形成真正可维护的 React 组件，而不复制多个外观相同的组件。
6. 离线的 `.fig` 解码工具是第三方社区库，不承诺支持所有新版格式，解析失败时先检查兼容性，不要暗中降级为参考图猜测。
7. `UX05/06`、`UX09/10`、`UX13` 分别是三个长页的续段，正式业务 UI 需合并内容而不是简单重复页面。
8. 真实店铺登录、批量操作、AI 回复、订单处理必须单独实现和经授权验证；v0.3.0已接入desk-v1本地服务，具体范围见docs/INTEGRATION.md；真实外部平台尚未自动验收，禁止在测试中触发真实买家发送。
9. 禁止提交任何账号凭据、用户聊天数据、完整设计快照或原始 `.fig`。若部署开源，先审查所有 Figma 生成图片及文字。
10. 每次修改执行 `npm run typecheck`、`npm test`、`npm run build`，涉及画板或路由需执行 `npm run test:e2e`。
11. 功能分支提交，禁止直接覆盖 `main`。没有完成真实 Figma 视觉验收的页面不得标记为设计完成。

## 双人协作试行

两边 Codex 使用同一个 GitHub 仓库的 Issue 和 Draft PR 交接，每项任务用独立分支或工作树。

1. **开工前查重。** 查看打开的 Issue 和 PR，尤其是带有“认领中”的任务。认领 Issue 记下负责人、分支、仓库相对路径（或 glob）及预计释放时间。双方认领重叠时，由双方确认一名写入负责人，再动手修改。
2. **范围变化先更新。** 开始改动新增路径前，重新查 Issue 和 PR，并更新认领范围。两边都需要修改共享文件（如 `electron/main.cjs` 或 `package.json`）时，由写入负责人修改，另一方在 Issue 留下接口需求。
3. **尽早共享实际改动。** 推送首批改动后开 Draft PR，关联 Issue，写明影响路径和接口变化。需要对方处理时，在 Issue 或 PR 中 @ 对方的 GitHub 账号。开工、扩大范围和提交前主动查阅相关讨论。
4. **完成后交接。** PR 合并或任务取消后，在 Issue 标记认领已释放，并写明下一位接手需要同步的分支或提交。

认领是人工协作约定。两边几乎同时认领同一路径时，以 Issue 中双方确认的负责人为准。无法访问 GitHub 或看不清归属时，先向用户确认当前范围。
