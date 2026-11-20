# 左下角 Footer 与旧版更新检查核对（2026-11-21）

## 任务与边界

分支 `codex/sidebar-update-entry-20261121`，worktree `C:/Users/90760/.codex/worktrees/knowledge-product-editor/client`，基线 `25cf3cb`。只修改本 worktree 的 app 布局/footer、共享 UI 兼容小改、相关测试和本文档；未修改 E 盘主目录、真实业务数据、服务端、vendor、支付、AI 发送或模型流程。版本号、package-lock、公开安装包和最终 HANDOFF 由根任务统一处理。未提交、推送、打包、发布、安装，也未启动真实软件。

## 旧安装版为什么没有更新提示

### 安装版身份与静态证据

- `C:/Program Files/YunduoCustomerService/LingtuAI/LingtuAI.exe`：FileVersion `1.0.88`，ProductVersion `1.0.88.0`；核对时 `LingtuAI.exe` 进程数为 0。
- `resources/app.asar` SHA256：`8779ed16ddd2248efe7860dfc49641e3587ff1557fd16efb7256ea8bf5c3bc75`；包内 `package.json` 版本为 `1.0.88`。
- 从 ASAR 仅抽取更新检查相关文件做惰性阅读，未执行旧包，未扫描私有 userData。`dist-electron/main.cjs` 中 `createAppUpdateChecker(currentVersion, request = fetch)` 只有一个 API 地址：
  `https://api.github.com/repos/907609732/LTTLT-AI-Customer-Service/releases/latest`。
- 该实现遇到非 2xx 直接抛错；没有 1.0.89 起加入的官方 `/releases/latest` 302 发布页备用链。因此匿名 API 限流、网络失败或响应异常时，旧版只能显示“检查失败，点击重试”，不会显示版本更新。粘贴证据为 `artifacts/sidebar-update-20261121/installed-asar/updater-excerpt.txt`。
- 能由包内代码确认的是“缺少限流备用链”这一事实。本次默认网络实际收到 API 403 + `x-ratelimit-remaining: 0`（见下），旧 1.0.88 在这种响应下会直接失败；用户当时旧程序关闭期间的历史过程没有重新打开旧包重放，不能把静态推断冒充那一次运行记录。

### 两条网络路径（必须区分）

- 显式命令级代理 `http://127.0.0.1:7890`：匿名 API HTTP 200，`remaining: 2`；`tag_name = v1.0.92`，`draft = false`，`prerelease = false`，资产含 `LingtuAI-Setup-1.0.92-win-x64.exe`；官方 `releases/latest` 302 到 `v1.0.92`。未改全局代理、未使用令牌或账号 Cookie。
- Codex 独立默认网络路径（不加 `proxy-server` 覆盖，对应生产 IPC 网络路径）：真实 API 返回 403 + `remaining: 0`；当前检查器的真实官方发布页备用链随后成功发现 `1.0.92`。证据 `codex-default-network.json/log`，退出码 0。
- 因此不能笼统写“当前 API 正常”。准确结论是：显式 7890 路径 API 200；默认路径本次真实限流，但新版备用链可用。旧安装包只有 API-only，所以会在这条已观测的默认路径响应上失败。
- 原始脱敏头/JSON 在 `artifacts/sidebar-update-20261121/public-status/`；汇总在 `evidence-summary.json`。未下载安装包。

### 当前检查器隔离 Electron 验证

用当前 `electron/app-update.ts`、`electron/app-update-page.ts` 生成临时 CJS bundle，在隐藏 Electron 43.8.9、临时 userData、无业务窗口的环境测试：

- 显式代理路径的真实 API 200：`1.0.88 → available / latest 1.0.92`；`1.0.91 → available / latest 1.0.92`。
- 默认网络路径：真实 403 后，真实 `/releases/latest` 302 与真实 `expanded_assets` 返回 `available / 1.0.92`。该结果由 Codex 独立执行，未重复。
- 单独注入“API 403 + `x-ratelimit-remaining: 0`”：官方页面仍真实访问并返回 `available / 1.0.92`；API 200、302 和 expanded assets 是真实 GitHub，只有注入分支的 API 响应是测试夹具。
- 因为当前检查器没有这些真实缺陷，本轮没有修改更新器或扩大备用链规则。旧 1.0.88 二进制无法隔空修改，需手动安装已公开发布的 1.0.92；新版后续若发现真实回归，应先单独复现再最小修复。

证据：`artifacts/sidebar-update-20261121/e2e-update-check.json`、`e2e-run.log`、`codex-default-network.json/log`、`evidence-summary.json`。

## 左下角两处统一

新增 `src/app/components/SidebarFooter.vue`，`MainLayout.vue` 与 `ShopManageView.vue` 都只挂载这一组件。视觉只改 footer：深色背景、圆角黑色“剩余算力”卡、居中千分位数字、白色“充值”按钮、描边“添加客服 / 使用教程 / 检查更新”三个全宽按钮，最底部“当前 v实际版本”由 `AppVersion` 从 `__APP_VERSION__` 注入。未硬编码参考图版本或余额。

复核修正：footer 显式 `align-items: stretch`，工具行、算力卡和帮助按钮均为 footer 内宽 100%；卡内数字用容器宽度响应字号并 `white-space: nowrap`，已在 300px、204px 和 150px 宽度分别验证 `1,000,000`、`300,000` 不被拆行；150px 时快捷工具自动改为单列。检查更新图标改为正确的循环刷新箭头，不再使用时钟图形；footer 内联更新提示使用相对定位，关闭按钮属于提示卡自身，不再盖住检查更新按钮。

- `src/app/sidebar-footer.ts` 只从 `runtime.snapshot.managed.session.account.trial.remaining` 派生余额。该 legacy 字段名虽为 `trial`，服务端实际聚合试用与付费可用次数，因此界面文案为“账号当前可用次数”；无数字时写“已登录，但尚未取得可用额度”。登录条件与 `use-billing.ts` 一致：`active.mode === managed`、非 `restartRequired`、`session.status === signed_in`。失败/未登录/本机 Key/待重启分别显示“需登录 / 本机 Key / 待重启 / 待核对”，绝不补造数字。没有新增轮询、网络或 IPC，快照仍由既有启动同步和业务刷新更新。
- 充值：仅托管已登录时由父层跳现有 `/shop/recharge`；未登录时复用 MainLayout 的现有 `LoginDialog`。配置中心通过 `login` 事件交给父层，不另建认证。
- 添加客服：复用 `shared/ui/ContactQrDialog.vue`，仍如实显示“联系方式暂未配置”。配置页把 `contact` 事件交给 MainLayout，共用同一个弹窗实例。
- 使用教程：`openOfficialTutorial()` 固定打开 `https://github.com/907609732/LTTLT-AI-Customer-Service#快速使用`，仍经既有 `openExternal` 受限桥接；服务层额外校验 HTTPS、`github.com`、固定仓库路径和锚点。该 URL 通过现有桥接校验，未改为任意/站外地址。
- 检查更新：复用 `UpdateStatus.vue` 的启动检查、手动重试、失败提示、下载页和下载错误重试。新增可选 `variant="footer"`；默认调用保持原样。发现更新时按钮显示具体 `v1.0.92` 并高亮，提示卡保留，footer 内联显示且自动滚入可见区。最近一次手动检查失败会优先显示“检查失败，点击重试”，不会继续用缓存的“发现新版本”覆盖网络错误；失败后重试成功再恢复正常结果，已有 `available → failed → current` 回归。
- 保留快捷回复、回复监控和待确认数；配置中心原有的监控 `busy`/`error` 由 footer 继续展示。
- `MainLayout` 的原生店铺页遮挡逻辑保留，并把联系方式弹窗纳入同一 `presentStore` 可见性条件；配置页事件不会让平台页盖住弹窗。footer 事件监听现在只附到 `shop-manage` 配置路由，首页/知识库等组件不再收到无关 `contact/login/quick-reply/recharge` listener；登录、联系方式、快捷回复弹窗仍由 MainLayout 唯一持有。
- 低窗口下店铺列表保留至少 64px 独立滚动；footer 自身有界滚动，`ShopManageView` 侧栏改为“标题 / 可滚动菜单 / footer”三行，底部按钮不再挤压或覆盖关键列表。

## 验证

命令与退出码汇总：`artifacts/sidebar-update-20261121/verification-summary.json`。

- 定向组件/导航/状态测试：5 文件 31 项通过（`review-fix-tests.log`）。
- `npx vue-tsc --noEmit`：exit 0，green 记录 `vue-tsc-green.log` / `vue-tsc.log`；首次 TS2769 失败日志保留在 `vue-tsc-first-failure.log`。`npx tsc -p config/tsconfig.electron.json --noEmit`：exit 0，`electron-tsc-green.log` / `electron-tsc.log`。
- 改动文件 ESLint：exit 0；Prettier check：exit 0；`node scripts/check-boundaries.mjs`：通过。日志分别为 `review-fix-eslint.log`、`review-fix-prettier.log`、`review-fix-boundaries.log`。
- `npm run build`（Vite + Electron main/preload）：exit 0，构建 `lingtu-ai@1.0.93`，`source-build-93.log`。
- 隔离真实 Vue 组件预览：Vite 构建后由隐藏 Electron BrowserWindow 截图，合成账号和数值仅用于布局验证，不进入产品源码；截图与 `metrics.json` 在 `artifacts/sidebar-update-20261121/preview/shots/`。首轮宽度收缩与关闭按钮重叠图保留在 `preview/first-round/`。
  - 1440×900：footer 宽 300px，卡/工具/按钮内宽均 280px，全部按钮在视口内，版本 `当前 v1.0.93`。
  - 1024×480、900×360：店铺列表保持 64px；footer 分别 230px、110px 内部滚动。脚本实际滚动每个按钮与版本，`reachability.allReachable = true`；`low-900x360-bottom.png` 证明底部按钮和版本可到达。
  - 204×720：卡/工具/按钮宽度均 184px；`12,345`、`300,000`、`1,000,000` 都是单行，无横向溢出。
  - 150×720：卡/工具/按钮均 120px；`1,000,000` 自动降至 20px 单行，工具改单列；`footer-150x720-quota-1000000-bottom.png` 显示滚到底后所有按钮和 `当前 v1.0.93` 可达。
  - 更新提示：footer 变体显式 `inset: auto`，清除基础绝对定位的 `bottom/left`；新截图与指标显示提示卡左右缘和全宽按钮同为 10/184px，`dismissInsideNotice = true`。上版图保存在 `preview/first-round/footer-update-204x720-before-inset-reset.png`。
- 未运行全量 `npm run check`、`npm run test:desktop`、打包/安装/发布。

## 未解决与交接

- 本机安装版仍是 1.0.88，公开正式版仍为 1.0.92；本轮未打开真实桌面，需要用户手动安装已公开的 v1.0.92，旧版不会因源码修改自动更新。
- 截图是隔离合成预览，不是真实账号、支付订单或真实 Electron 主窗口验收；没有创建订单、自动付款或读取真实余额。联系方式仍复用“暂未配置”的现有弹窗。
- root 已把 `package.json` / `package-lock.json` 统一改为 1.0.93；本分支保留该改动，不再升版本。最终 HANDOFF、整合和实际窗口验收由 root 处理，本次不提交、不打包、不发布。
