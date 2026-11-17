# 源码开发调试（回复监控 GM / CMD）

## 入口与边界

工作台左下和配置中心左下提供同一个“回复监控”入口；打开的是现有 340×300 单例子窗口，仍随主窗口左下角锚定、`showInactive` 显示、不全局置顶。源码运行时底栏出现“开发调试”，在同一窗口展开到 960×620（受父窗口内容区约束），左侧 340px 保留回复与确认/取消，右侧为 GM 指令 / CMD 终端。宽度小于 720px 时上下排列。收起只隐藏调试区，终端会话保留；“收起调试”不会改变回复批准状态。

打包版没有开发调试能力，且没有环境变量、命令行或渲染层开关可以开启：

- 主进程以 `app.isPackaged` 为唯一权威。打包版不创建 `DeveloperDebugController`，不注册 `developer-debug:*` IPC，`ReplyMonitorView` 的调试入口也不会出现。
- `scripts/build-electron.mjs` 只给监控窗口构建 `developer-preload.cjs`；普通 `preload.cjs` 的源码能力编译为 `false`。该文件不在 `config/electron-builder.json` 的 files 白名单内。
- 浏览器预览和任何平台网页都没有调试桥；不能用 URL、`window.yunduoDesktop` 参数或 `postMessage` 取得它。

## 窗口与 owner 租约

唯一 owner 是当前回复监控窗口的**服务主 frame**：

1. `event.senderFrame === event.sender.mainFrame`；
2. sender 必须是应用窗口（`isAppWebContents`），URL 必须是受信渲染页且 hash 恰为 `#/reply-monitor`；
3. `BrowserWindow` 必须是 `replyMonitor-window` 当前持有的子窗，WebContents id 必须与 controller 当前 owner 一致；
4. 每个请求还带当前 `workspaceId`；controller 同时核对工作区仍可访问。

关闭监控窗口、切换工作区、退出软件或重建 owner 会停止当前终端宿主。旧宿主注册的 data/exit 回调绑定旧 owner，不能把迟到输出投递给新窗口。监控窗口关闭后下次打开回到紧凑布局，需要重新连接 CMD；系统不会恢复旧 shell。

## GM 指令注册表

GM 只提供有类型的固定命令，不做 `eval`、JS 执行、任意 IPC 或发送网关。首批命令：

```text
help
status
stores
logs [数量]        # 1～100，默认 20；也接受 logs[20]
pdd-popup status   # 需要在窗口内显式选择拼多多店铺
pdd-popup allow
pdd-popup block
```

输出有界（最多 12000 字符），日志逐行截断并再次脱敏。`status` 不读取配置、模型密钥、托管令牌或完整认证信息，只显示版本、工作区标识、店铺数量、终端连接状态；`stores` 只显示店铺 id/名称/平台/在线/登录/AI/发送模式和 PDD 后台域名。GM 成功不代表买家消息已发送，真实发送仍必须经过统一回复确认门与平台回执。

扩展新命令时：在 `electron/developer-debug/gm.ts` 的注册表增加只读/受限操作和参数校验，同步补 `tests/developer-debug-gm.test.ts`，把范围、owner、生命周期和验收写回本文。不要复制临时 inspector 脚本、调试网络抓包或任意命令执行到正式功能。

### pdd-popup

策略只存在于本次源码运行的内存，按显式 `storeId` 生效；正常重启恢复厂商默认。实现位于 `electron/developer-debug/popup-policy.ts`，不改 `vendor/`：

- 只接受厂家 `manager.webContentsOf(storeId)` 返回的实际 WebContents，并核对当前 URL 是 `https://mms.pinduoduo.com/...`；不接受全局 URL 扫描。
- Electron 的 `WebContentsView.getType()` 可能返回 `window`，`BrowserWindow.fromWebContents(view.webContents)` 会返回父窗口而不是 `null`。因此不能据此判断“是否内嵌页”；必须用实际 store WebContents 与 owner WebContents 区分，owner 自身不能被当作店铺页。
- `allow` 只允许 HTTP/HTTPS/about:blank 的常规网页新窗口；子窗口覆盖 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、`webviewTag: false`。其他协议拒绝。
- `block` 恢复厂商原有语义：`shell.openExternal(url)` 后 deny；不修改验证码、登录、网页自身 `window.close()`、发送批准或平台页面。
- 新打开的 PDD 店铺页会按本次运行的对应店铺策略重新绑定；状态只在当前 PDD 内嵌页生效。后台采集 `BrowserWindow` 不会因 URL 相似而被误识别。

## CMD 终端

- 只有用户点击“连接 CMD”才启动 `cmd.exe`；默认 cwd 是源码项目根（`dist-electron` 的上一级），使用当前 Windows 用户权限，不自动提权、不使用单行 `exec` 降级。
- 宿主是 `node-pty`（官方 1.1.0，开发依赖）的 Windows ConPTY 会话；终端是 `@xterm/xterm` 6.0.0 + `@xterm/addon-fit` 0.11.0，组件只在首次进入 CMD 标签时异步加载。
- 支持连续输入输出、中文、`cd`、方向键、Ctrl+C、窗口 resize、清屏、断开和重新连接。清屏只清 xterm 显示；不删除主进程 64 KiB 有界回放缓冲。
- 输入/输出绑定 owner、workspace 和 session id；resize 只接受 1～500 的整数行列。关闭窗口、切换工作区或退出时结束当前进程树；旧 session 的写入请求明确失败。
- 打包版不包含 `node-pty` 运行依赖，也不会创建终端。esbuild 将 `node-pty` 标记为 external，源码运行在点击连接时动态 require；`npmRebuild:false` 的原生模块兼容性由隔离 Electron 验收。

## 验收入口

相关单元/交互测试：

```powershell
npx vitest run tests/developer-debug-gm.test.ts tests/developer-debug-pty.test.ts tests/developer-debug-bridge.test.ts tests/developer-debug-review.test.ts tests/developer-terminal-lifecycle.test.ts tests/reply-monitor-window.test.ts tests/reply-monitor.test.ts tests/reply-monitor-developer.test.ts tests/main-sidebar.test.ts tests/shop-manage-monitor.test.ts
npm run typecheck
npm run build
```

隔离原生验证（临时 userData、不连接真实店铺、不发送买家消息）：

```powershell
$env:LINGTU_DESKTOP_CHECKS='business:developer-console'
node scripts/run-desktop.mjs
```

该检查覆盖：主工作台 preload 无调试桥；监控窗口 compact/展开尺寸与 parent/非置顶；GM help 输出；真实 ConPTY 中文、方向键、Ctrl+C、resize；收起再展开复用同一 session；关闭监控后新窗口获得新 shell，旧 session 写入被拒绝。证据写入 `artifacts/desktop-selected-*/developer-console.png` 与 `report.json`。

Windows 无控制台或窗口 teardown 与 write 并发时，控制台会打印旧 session `pty-write` 被 owner/会话租约拒绝的 IPC 日志；这是旧会话请求的预期拒绝，当前隔离检查仍以报告和退出码为准。若它变成真实会话失败、主进程未捕获错误或新窗口接受旧 session，必须停止并重新验收，不能把该告警当作通过。

打包产物验收由独立 Release/Codex 执行，日常本机检查不等于安装包已验证：确认 `dist-electron/developer-preload.cjs` 未进入 ASAR、`preload.cjs` 不暴露 `developerDebug`、安装版没有 `developer-debug:*` handler，且 `node-pty` 不随包分发。
