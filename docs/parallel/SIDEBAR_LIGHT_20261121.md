# 首页白色底栏与配置中心回退（2026-11-21）

## 任务与边界

分支 `codex/sidebar-light-20261121`，worktree `C:/Users/90760/.codex/worktrees/knowledge-product-editor/client`，基线 `c03ae24`。只改 4 个布局/UI 文件、直接相关测试和本文档；`package.json` / `package-lock.json` 的 1.0.94 由 root 统一维护，本分支保留但不改版本。未触碰 E 盘主目录、真实账号、真实余额、服务端、vendor、更新器网络、支付、AI 发送或知识数据；未提交、推送、打包、发布、安装或启动真实软件。

UI 方案以 `artifacts/sidebar-light-20261121/design/ui-spec.md` 为唯一依据，没有另行设计、生成图片或向用户追问。

## 实际改动

### 1. 首页白色底栏

`src/app/components/SidebarFooter.vue`：

- 容器改为白底 `#fff`、顶部分隔线 `1px solid #e8e8eb`、默认文字 `#606266`、`padding: 10px`、`gap: 8px`；保留原 `max-height: min(48vh, 360px)`、内部滚动、`container-type: inline-size` 和 170px 单列阈值，不加阴影。
- 快捷回复/回复监控：30px 高、双列 6px 间距、白底 `#e4e7ed` 边框、8px 圆角、12px 文字、13px 图标；hover 为 `#f5f7fa` / `#2453e8`。待确认数改为 `#edf2ff` 底、`#2453e8` 字，尺寸不变。
- 余额卡：白底、`#e4e7ed` 边框、10px 圆角、原 `9px 9px 10px` padding；删除黑底和内阴影；标题 12px/17px，小圆点 `#b7c3d7`，数字保持 20–30px 容器响应字号、38px 行高、居中，颜色 `#2453e8`；无数字状态 18px。
- 充值：29px 高、8px 圆角、`#3366ff` 蓝底白字、12px/600、hover `#2453e8`。选择器写成 `.app-sidebar-footer button.recharge-button`，避免 `workbench-light.css` 的 `.workbench-shell .sidebar-footer button { color: #606266 }` 覆盖白字；未使用 `!important`。
- 添加客服/使用教程/检查更新：保持 34px 纵列、8px 间距、9px 圆角；白底 `#e4e7ed` 边框、`#606266` 文字、15px 图标，hover `#f5f7fa` / `#cbd6ec` / `#2453e8`。
- 版本 11px/17px `#909399`，真实错误 `#c45656`，所有按钮 `:focus-visible` 使用 `2px solid #8fabff`、offset 2px。余额仍只来自既有账号快照，无新轮询、IPC 或依赖。

`src/shared/ui/UpdateStatus.vue`：

- 仅 footer 变体改色：普通/失败入口为白色描边按钮；`has-update` 使用 `#edf2ff` 浅蓝底、`#cbd9ff` 边框、`#2453e8` 600 文字，不再使用深色底。
- 内联提示仍为 `position: relative; inset: auto`，白底、`#dce6f5` 边框、9px 圆角、12px padding、无阴影；标题 `#303133`/12/600，正文 `#606266`/11/1.6，关闭按钮 `#909399`，下载按钮 `#3366ff` 白字。
- 启动检查、手动重试、失败优先、下载页、关闭和 `scrollIntoView` 逻辑未改；更新器和服务端未动。

### 2. 配置中心移除新 footer

`src/app/layouts/ShopManageView.vue`：

- 删除 `SidebarFooter`、`useSidebarBalance`、仅供新 footer 的 `defineEmits` 和转发事件。
- 恢复旧的 `sider__monitor` 简洁入口：忙碌禁用、真实失败提示、`pendingReplyCount` 待确认数；底部使用实际构建注入的 `AppVersion`，不恢复旧 `UpdateStatus`。
- 侧栏网格恢复为“标题 / 可滚动菜单 / 监控 / 版本”，保留原有菜单滚动和 `data-v-105c9fec` 属性；配置页数据功能未改。

### 3. MainLayout 去除转发死逻辑

`src/app/layouts/MainLayout.vue`：

- `<router-view />` 恢复简单写法，删除仅为配置页转发 `quick-reply/contact/login/recharge` 的 `v-if="isConfiguration"` 分支。
- 首页仍挂载白色 `SidebarFooter`，登录/客服/快捷回复弹窗仍由 MainLayout 唯一持有；原生店铺页隐藏、知识库离开守卫、AI 与其余路由未改。

### 4. 测试

- `tests/shop-manage-footer.test.ts`：改为断言配置页没有 `SidebarFooter`、额度、充值、客服、教程、检查更新和快捷回复，但仍显示旧回复监控、待确认数、忙碌禁用、失败提示和实际版本。
- `tests/main-sidebar.test.ts`：删除“配置路由挂 footer 监听/充值转发”的旧断言，改为首页与配置路由都不附加 footer 事件监听；保留原生页隐藏、知识库离开、首页 footer 监控等原行为。
- `tests/shop-manage-monitor.test.ts`：保留旧监控点击断言；`AppVersion` stub 声明 `prefix`，消除 Vue 测试警告。
- 纯 CSS 不写镜像实现测试。

## 验证

命令与退出码汇总：`artifacts/sidebar-light-20261121/verification-summary.json`。

| 检查                                | 结果                                                       |
| ----------------------------------- | ---------------------------------------------------------- |
| 定向测试 6 文件                     | 30 项通过，exit 0（`tests-focused.log`）                   |
| `npx vue-tsc --noEmit`              | exit 0（静默通过，命令回执见 `events.jsonl`）              |
| 改动文件 ESLint                     | exit 0（静默通过，命令回执见 `events.jsonl`）              |
| 改动文件 Prettier check             | exit 0（`prettier.log`）                                   |
| `node scripts/check-boundaries.mjs` | 通过，exit 0（`boundaries.log`）                           |
| `npm run build`                     | exit 0，构建 `lingtu-ai@1.0.94`（`source-build-94.log`）   |
| 隔离预览构建 + Electron 截图        | 均 exit 0（`preview/build.log`、`preview/screenshot.log`） |

未重复运行未修改的更新器网络、真实支付/买家发送、REA、`npm run check`、`npm run test:desktop`、完整 Release 或安装包验收。

## 截图与指标

目录 `artifacts/sidebar-light-20261121/preview/`，由现有隔离 Vite + 隐藏 Electron `BrowserWindow` 工具生成；无业务 preload、无真实 userData。合成账号、额度、待确认消息和更新响应都只用于预览。

- `shots/home-wide-1440x900.png`：正常首页蓝白外壳，300px 侧栏内白色 footer、蓝色充值和浅蓝徽标。
- `shots/footer-300x720.png`、`footer-204x720.png`、`footer-150x720.png`：300/204/150px 合成底栏，`1,000,000` 单行，150px 工具改单列，版本可见。
- `shots/footer-300x720-update-available.png`、`footer-204x720-update-available.png`：发现更新浅蓝入口 `rgb(237,242,255)` / `rgb(36,83,232)` / `rgb(203,217,255)`，内联白底提示，关闭按钮在提示内。
- `shots/footer-low-204x360-update-available-bottom.png`、`home-low-900x360-bottom.png`：低高度内部滚动到底，实际 `scrollTop` 分别为 278、214；按钮和版本可达。
- `shots/config-1440x900.png`、`config-sider-152x720.png`：真实 `ShopManageView` 配置页。左侧栏实际 152px，只显示“回复监控 · 2 待确认”和 `v1.0.94`；指标确认没有新 footer、额度卡、充值、客服、教程或更新入口。
- `shots/metrics.json`：footer 背景均为 `rgb(255,255,255)`，充值均为 `rgb(51,102,255)` 底 / 白字，更新入口与提示样式如上，首页/窄栏/低高度均无横向溢出。

## 未解决与交接

- 截图为隔离合成预览，不是真实账号、真实余额或真实主窗口验收；未读取或修改任何真实账号数据。
- 配置页截图为真实组件 + 合成快照，店铺面板内容仅用于布局；实际窗口和设计师复核仍由 root 整合后执行。
- 本分支保留 root 的 1.0.94 版本改动；未提交、未推送、未打包、未发布。最终合并、真实窗口启动与交付由 root 处理。
