# 检查更新失败修复（2026-11-20，限流备用路径）

## 任务与边界

修复 1.0.88 安装版左下“检查更新失败”。分支 `codex/update-check-fix-20261120`，基线 `43d3832`。仅在本独立 worktree 修改，未触碰主目录未提交的 AGENTS、真实资料、店铺、账号、AI 开关或发送流程；未改版本号、未打包、未创建 tag/Release、未重启当前 1.0.88 安装版、未推送或部署。按用户要求版本递增、主干整合与实际主窗口验收由 Codex 统一执行。

## 根因（真实证据）

`electron/app-update.ts` 只请求 `https://api.github.com/repos/907609732/LTTLT-AI-Customer-Service/releases/latest`。2026-11-20 通过本机现有 FlClash 出口匿名实测：

- 原始证据（只读，复制件与原件哈希一致）：`E:\~1awucheng\Plastic SCM\AI电商客服软件\client\artifacts\update-check-fix-20261120\public-api.headers`、`public-api.json`；本 worktree 的 `artifacts/update-check-fix-20261120/` 下保留同哈希副本。
- 本次复核 12:12 再测：HTTP 403，`X-RateLimit-Limit: 60`、`X-RateLimit-Remaining: 0`、`X-RateLimit-Resource: core`，见 `artifacts/update-check-fix-20261120/api-now.headers.txt` 与 `api-now.json`。
- 公开最新正式版仍为 `v1.0.74`（`/releases/latest` 真实 302 到 `releases/tag/v1.0.74`），当前安装私有版为 `1.0.88`。

匿名 API 额度耗尽让检查直接抛错，UI 如实显示“检查失败”；没有把 403 或网络失败伪装成“已是最新”。本次修复只解决限流时的可用性，不改变“公开版比安装版旧不提示升级”的语义。

## 限流判定（明确定义）

只有以下真实限流信号才启用备用路径：

- HTTP 403 且 `x-ratelimit-remaining: 0`（GitHub 匿名主限流）；或
- HTTP 429（次级限流，`Retry-After` 不参与判定）。

其他情况一律保持原失败或原成功行为：403 无该头、403 仍有剩余额度、401/5xx、API 200 的畸形 JSON、超限响应、草稿、预发布、标签不合规、缺安装包，都不会启用备用页，也不会返回 `current`。404 仍按“无正式版”处理。

## 实现

- `electron/app-update.ts`：API 正常路径保持原请求头、`redirect: 'error'`、`credentials: 'omit'`、256 KiB 有界读取与启动缓存/手动刷新/并发合并。限流时调用备用路径；API 与备用链共用同一个 `AbortSignal.timeout(15_000)`（不因备用链倍增）。
- `electron/app-update-page.ts`（新增）：Electron `net.request` 只读适配器。使用 `partition: 'lingtu-app-update'` 的内存 session（无账户 Cookie/磁盘缓存），不带令牌或认证头；`redirect: 'manual'` 下在 `redirect` 事件里取真实 `Location` 后立即中断，**不跟随任何跳转**；响应读取上限 256 KiB。
- 备用流程：先取 `/releases/latest` 的 302 `Location`，用固定正则逐字符校验必须是 `https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v<三段版本>`；再从**已校验版本**自行构造 `releases/expanded_assets/v<版本>`，要求 200、`text/html`、有界，并同时出现精确的 `href="/907609732/.../releases/download/v<版本>/LingtuAI-Setup-<版本>-win-x64.exe"` 与精确文件条目。只有全部通过才返回结果；不下载/执行安装器。
- `electron/ipc.ts`：仅把 `requestGithubPage` 注入既有 `createAppUpdateChecker`（3 行装配）。未新增/修改 IPC 通道、preload、共享契约或 UI；`app:check-updates` 的来源校验、参数校验和返回结构不变。
- `tests/app-update.test.ts`：新增限流、严格跳转、缺包、超时/并发、畸形 API 等回归。
- `docs/ARCHITECTURE.md`：同步新增模块与备用路径边界。

## RED → GREEN

- RED（实现前，仅新测试）：`8 failed | 9 passed`；失败集中在“403+remaining 0 / 429 应经官方页面返回 1.0.74/1.0.75”等新增行为。日志 `artifacts/update-check-fix-20261120/red-tests.log`。
- GREEN：`tests/app-update.test.ts` 18/18 通过；`app-update.test.ts` + `app-update-ui.test.ts` + `runtime-logs-ipc.test.ts` 共 24/24 通过。日志 `green-tests.log`、`related-tests.log`、`commands.log`。
- 覆盖：启动一次/手动刷新/并发合并；API 200 正常、同版/旧版不升级、草稿/预发布/缺包/畸形/超限；403+header 与 429 触发；403 无头/有额度、401/500 不触发；恶意跳转（http、站外、其他仓库、预发布、无 v、查询串/锚点/尾斜杠、非跳转、404）；备用页缺精确安装包、错误下载仓库/版本、非 HTML、超限、302、500；备用页网络失败不返回 current；15 秒单信号且无重试；限流后并发合并与后续手动刷新。

## 真实 Electron 验证（隔离临时 profile，隐藏运行，未启动业务窗口）

环境：本机 Electron 43.8.9，`artifacts/update-check-fix-20261120/` 下脚本与结果；未打印凭据或真实用户数据，未下载安装器。

1. `net.fetch` 能力复核（`net-fetch-probe.json`）：`redirect: 'manual'` 直接报 `Error: Redirect was cancelled`，且 `response.url` 为空、`redirected=false`。因此不能用 `net.fetch` 做逐跳校验。
2. `net.request` 能力复核（`net-request-debug.json`）：`redirect: 'manual'` 的 `redirect` 事件给出 `302`、真实 `Location` 与响应头；`response` 事件给出去压缩后的 HTML。适配器据此只取 Location、不跟随。
3. 端到端（`e2e-update-check.json`，真实 API + 真实 GitHub 页面）：
   - 12:12 真实 API 为 403/remaining 0（`api-now.*`）。
   - 12:20 复测时匿名额度已恢复：真实 API 返回 200（remaining 49→44），正常路径直接返回 `1.0.88 → current（latest 1.0.74，不降级）`、`1.0.73 → available（1.0.74）`，未访问发布页。
   - 因 API 已恢复，另注入**仅 API 403 响应**（`apiMode: real-api-recovered-injected-403`），备用链仍真实访问 GitHub：`/releases/latest` 真实 302 到 `github.com/.../releases/tag/v1.0.74`；`expanded_assets/v1.0.74` 真实 200、20648 字节、含精确 `LingtuAI-Setup-1.0.74-win-x64.exe`。1.0.88 得 `current`，1.0.73 得 `available` 且下载页固定为 `releases/tag/v1.0.74`。
   - 适配器对真实下载跳转（会去 `release-assets.githubusercontent.com`）返回 302 且 `bodyBytes: 0`，证明未跟随站外；不存在的标签页返回 404（224452 字节，仍在 256 KiB 内）。
   - 明确区分：真实 = API 状态与全部 GitHub 页面请求；模拟 = 仅在 API 已恢复后注入的 403 响应。

## 静态检查与实际运行范围

- `npx tsc -p config/tsconfig.electron.json --noEmit`：退出 0。
- `npx vue-tsc --noEmit`：退出 0。
- 改动文件 ESLint、Prettier 检查：退出 0。
- `node scripts/check-boundaries.mjs`：通过。
- `npm run build:desktop`：退出 0；`dist-electron/main.cjs` 已包含新适配器（`lingtu-app-update`）。
- 未运行：全量 `npm run check`、`npm run test:desktop`、打包/安装、发布流程；未重启或操作真实安装版与店铺。

## 复核补强（Codex 复核 b1555e0 后）

- 显式认证边界：`net.request` 增加 `credentials: 'omit'` 与 `useSessionCookies: false`。独立内存 partition 只保证没有现存 Cookie；Electron 类型说明未指定 `credentials` 时会发送 session 认证数据并可能触发 `login`，因此不能仅靠 partition 表达“禁止认证”。仍保持 `redirect: 'manual'` 与拿到 Location 后立即中断。
- 字节口径统一：检查器对备用页正文改用 `Buffer.byteLength(body, 'utf8')`，与适配器 256 KiB 字节流上限同口径；新增中文多字节超限回归（字符数在旧口径内、UTF-8 字节超限）。
- 新增 `tests/app-update-page.test.ts`（8 项，事件驱动假 `net.request`，无新依赖、无 `any`）：请求显式 omit 与内存 partition、只发 User-Agent/Accept、无 Cookie/Authorization 头；redirect 只回传 Location 并 abort、从不 followRedirect（含缺参回退响应头）；signal 已取消不建请求；运行中取消 abort+拒绝、迟到事件不改写且移除监听；响应超 256 KiB abort+拒绝、迟到 end/error 不能改成成功；正常响应按 UTF-8 结算并移除监听；请求错误、响应 error/aborted 均失败且迟到 end 不改写。
- RED（以 `b1555e0` 生产文件跑最终测试）：`2 failed | 25 passed`，失败项正是 credentials 选项与中文 UTF-8 超限；日志 `increment-red.log`。GREEN：4 文件 33/33（app-update 19、app-update-page 8、app-update-ui 3、runtime-logs-ipc 3）；`tsc`、`vue-tsc`、ESLint、Prettier、模块边界均通过；日志 `commands-increment.log`、`related-tests-increment.log`。
- 更新后原生 e2e 重跑（真实 API + 真实页面）：真实 API 200（remaining 59→58）时正常路径 `1.0.88 current`、`1.0.73 available` 且不访问发布页；注入 API 403 后真实 `/releases/latest` 302 到 `releases/tag/v1.0.74`，`expanded_assets` 200/20648 字节含精确安装器；`1.0.88 current`、`1.0.73 available`；站外下载跳转仍 302 且 body 0；不存在标签 404。新 credentials 选项在真实 Electron 网络栈可用，结果与补强前一致。旧结果保留 `e2e-update-check-before-credentials.json`，新结果 `e2e-update-check.json`，日志 `e2e-run-increment.log`。
- 本次未改版本、未构建前端、未打包/重启/推送；未重复此前大量 probe 或全量 check/desktop。

## 已知边界与后续

- 备用路径只接受本项目现有 `v<三段版本>` 标签约定；若未来改为无 `v` 标签，备用链会安全失败（API 正常时不受影响）。
- GitHub 的 `/releases/latest` 语义与 API 一致（最新非草稿、非预发布），仍以版本比较决定是否提示。
- 限流备用页 404 或格式变化时返回“暂时无法检查更新/更新信息异常”，不会显示“已是最新”。
- 下一项：Codex 独立审查、主干整合、单次版本递增与实际主窗口验收；真实发布仍需单独授权。

## 证据清单（`artifacts/update-check-fix-20261120/`，忽略目录）

`public-api.headers`、`public-api.json`（原始只读复制说明见上）、`api-now.*`、`latest.headers.txt`、`tag-1.0.74.*`、`expanded-assets-1.0.74.*`、`net-fetch-probe.json`、`net-request-debug.json`、`probe-net-fetch.cjs`、`probe-net-request-debug.cjs`、`e2e-update-check.cjs`、`e2e-update-check.json`、`e2e-update-check-before-credentials.json`、`e2e-run.log`、`e2e-run-increment.log`、`red-tests.log`、`green-tests.log`、`increment-red.log`、`related-tests.log`、`related-tests-increment.log`、`page-adapter-tests.log`、`build-desktop.log`、`diff.patch`、`diff-increment.patch`、`commands.log`、`commands-increment.log`。
