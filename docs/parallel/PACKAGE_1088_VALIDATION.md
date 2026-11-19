# 1.0.88 云端全量桌面验收：过时夹具修复

分支 `codex/package-1088-validation`，基线 `2d8090a`（版本 1.0.88）。只修复 Electron 桌面验收夹具中与新八步引导、已删除入口不一致的部分，不改生产实现、vendor、契约 schema、发送/身份/工作区保护，不推送、不打包、不改版本。用户已授权本机安装打包，本轮未执行。

## 失败复现（RED）

云端失败日志（只读）：`E:\~1awucheng\Plastic SCM\AI电商客服软件\client\artifacts\install-1.0.88\cloud-failed.log`。本机按同一隔离方式复跑，结果与云端一致：`75/97` 通过，22 项失败，首个失败为 `add-store-direct-login: 216 !== 72`。

本机 RED 日志：`artifacts/package-1088-validation/00-red-baseline.log`。

### 根因

1. **`add-store-direct-login` 仍按旧布局断言**：新店八步引导在顶栏下方固定预留 144px 步骤条，vendor `platform-host.cjs` 用 `layout=onboarding-login` 时顶边是 216；夹具仍断言 72。属于过时几何期望，不是产品缺陷。
2. **`business:ui-add-store`、`sim:add-store-from-dialog` 寻找已删除的产品入口**：用户已要求添加弹窗只保留真实平台选择（`3fb185e`、`8a7b954`），`[aria-label="本机模拟店铺入口"]` 与 `店铺名称` 输入已不存在。夹具仍在等待并点击它，超时后 `storeA`/`storeB` 从未建立。
3. **下游连锁失败**：没有 `storeA` 后，商品保存、CSV、模型设置、上下文压缩、知识档案、商品资料编辑、尺码视觉、工单依次因“请先选择有效店铺”或缺少模型夹具失败。
4. **`restart-and-offline-draft` 报“会话质检记录损坏”**：夹具把当时的空 `storeA` 写进 `conversation-quality.json`，而 vendor 行 schema 要求 `storeId` 至少 1 个字符，于是重启读取被判为损坏。夹具自身还写死了 `platform: 'pdd-web'`/店名，与快照脱节。属于测试合成数据不符合当前 schema，不是质检存储缺陷。
5. **重启中断后的假失败**：`restart()` 在 `dispose` 之后建运行时失败，`business:snapshot` 处理程序未恢复，`business:buyer-message-ai-status`、全部 `sim:*` 和 `business:developer-console` 显示“工作区暂时不可用/本地服务已关闭”，是同一次失败的后果。
6. **`business:knowledge-product-editor` 对用例顺序敏感**：知识库窗口上下文是全局共享的，全量套件前面用例打开过其他店铺后，嵌入 `/knowledge` 页会跟随旧租约；单独运行该用例时上下文为空，回退到第一个店铺，因此“单跑通过、全量失败”。产品自己的店铺下拉可以切回目标店铺，属于夹具缺少显式选择，不是产品缺陷（临时移除该选择可稳定复现同一超时）。

## 修复（只动验收夹具）

- `electron/smoke.ts`（`add-store-direct-login`）：
  - 断言八步引导下登录视图为 `{x:300, y:216, width:内容宽-300, height:内容高-216}`，步骤条为 `{x:300, y:72, height:144}`、八个步骤顺序、登录为当前步骤、显示“请在下方完成平台登录”、旧基础设置页不出现、左侧店铺栏与顶部导航仍可用。
  - 点击“稍后继续”后断言步骤条收起、登录视图恢复普通布局 `y=72`、出现“继续店铺引导”入口；再次继续引导后恢复 `y=216`。保留并加强原“新八步布局/普通布局恢复”覆盖。
- `electron/business-checks.ts`：
  - `business:ui-add-store` 改为界面回归 + 仅测试 runtime 建店：断言弹窗 11 个真实平台、没有 `sim-local`/已删除入口/店名输入、未选平台不可提交、取消可关闭；随后用 `backendExecute add-store` 建立两个合成离线店铺（`pdd-web` 记录，不打开平台），并在配置中心店铺列表核对两张卡片。
  - `business:knowledge-product-editor` 在加载 `/knowledge` 后用产品店铺下拉显式切到目标店铺，去掉对其他用例残留上下文的依赖。
  - `business:restart-and-offline-draft` 先从快照取有效店铺，缺失即明确失败；会话、质检合成行使用该店铺的 `id/storeName/platform`，不再写空 `storeId` 或写死平台。
- `electron/sim-checks.ts`：
  - 原 `sim:add-store-from-dialog` 改为 `sim:add-store-runtime-fixture`：先回归添加弹窗不再出现本机模拟入口，再用仅测试 runtime 创建“本机演练店”，保留“添加不等于已打开”的断言；已删除弹窗截图 `sim-add-store-dialog.png`（对应入口已移除）。后续打开页面、一次性口令、顾客消息进会话、确认后人工回复、关店拒绝回复、模拟客服台、旧配置入口与截图检查全部保留。

未恢复被删除的产品 UI，未放宽任何成功判定、未删用例、未跳过、未吞异常。

## 验证

- 完整复现 RED：`npm run test:desktop` → `75/97`，与本轮云端失败集合一致（日志 `00-red-baseline.log`）。
- 首轮修复后：`96/97`，仅剩 `business:knowledge-product-editor`（日志 `01-full-after-fix.log`）。
- 补齐店铺显式选择后：`97/97` 全通过（日志 `03-full-final.log`，报告 `08-desktop-report.json`）。另有一次 `02-full-after-second-fix.log` 同为 `97/97`。
- 顺序依赖复现：仅运行 `business:ui-add-store,business:shop-setup-reuse,business:knowledge-product-editor`，临时去掉店铺选择时稳定失败，恢复后 `3/3` 通过。
- 静态检查：`npx tsc -p config/tsconfig.electron.json`、改动文件 ESLint、Prettier `--check`、`git diff --check` 全部通过（日志 `05-typecheck.log`、`06-eslint.log`、`07-prettier.log`）。
- 未重复运行全量 `npm run check`（云端已通过）；未运行 `test:packaged` 或安装包流程，未启动或终止主目录正在运行的真实应用。

## 未解决项与边界

- 无阻塞项。修复后完整 `npm run test:desktop` 已在隔离临时目录全通过。
- `business:ui-add-store` 用 `pdd-web` 离线记录做双店业务夹具，是为了不改变模拟客服台“单模拟店铺”的既有断言和 `openSimulatorPage` 选取语义；模拟店铺本身仍由 `sim:add-store-runtime-fixture` 经 runtime 创建并覆盖。
- 本机安装包、真实账号/平台验证、外部模型调用均未在本轮执行；`[skip ci]` 提交，未推送、未合并、未改版本。

## 第二轮：知识导入专项旧编辑入口修复

提交 `662f68e` 合入主干 `0373bd3` 后，第二次云端完整 `npm run check` 与 `test:desktop` 通过，knowledge manager 专项通过；`knowledge ingestion` 专项仍在旧入口阻塞。

- 云端失败日志（只读）：`artifacts/install-1.0.88/cloud-run2-failed.log`。首错：`electron/knowledge-ingestion-check.ts` 点击商品“编辑”后等待 `[aria-label="知识编辑与审核"]`，实际打开的是新版深色商品资料弹窗（`[aria-label="编辑商品资料"]`）。
- 本机完整复现：`node scripts/verify-knowledge-ingestion.mjs` → `Error: 页面等待超时 Boolean(document.querySelector('[aria-label="知识编辑与审核"]'))`，页面正文为商品资料弹窗（日志 `10-ingestion-red.log`、`10-ingestion-red-failure.txt`）。
- 根因：商品行“编辑”的入口在商品资料编辑弹窗改造后改为打开 `KnowledgeProductProfileDialog`；旧夹具直接等原问答编辑面板。新版弹窗通过“知识点”进入原问答编辑器，通过“原始资料”进入原来源版本面板。
- 修复（`electron/knowledge-ingestion-check.ts`）：
  - 点击“编辑”后等待 `[aria-label="编辑商品资料"]`，并核对弹窗 `[aria-label="商品知识点"]` 显示本商品的真实草稿计数（1 条草稿）。
  - 点击“知识点”进入 `[aria-label="知识编辑与审核"]`，核对模型学习产生的“材质尺寸”草稿可继续编辑，再用“保存并关闭”返回。
  - 再次“编辑”并点击“原始资料”直达本商品来源面板，然后保留原“原始资料 / 来源版本”选择、PDF 本商品来源导入、来源图片预览、学习本商品资料、真实视觉字节、未知调用闭锁、归档范围与批量审核部分失败的完整断言。
  - 未删断言、未跳过、未改成功判定、未增加自动重试；未改生产代码、schema、vendor、版本或 CI。
- 验证：
  - `node scripts/verify-knowledge-ingestion.mjs` 全通过，报告 7 项检查、5 次本机模型请求、`visibleWindows: false`（日志 `11-ingestion-fix1.log`，报告 `17-ingestion-report.json`）；`--reuse-renderer` 复跑同样 7/7 通过（日志 `11b-ingestion-confirm.log`）。
  - `node scripts/verify-knowledge-manager.mjs` 本机首次运行全通过，18 项检查、4 次本机模型请求（日志 `12-manager.log`，报告 `18-manager-report.json`）；未发现后续脚本夹具不兼容。
  - `scripts/package-smoke.ts` 只读核对：安装包冒烟通过 knowledge IPC `choose-sources`/`preview-import` 直接验证解析，不依赖商品“编辑”弹窗或 `知识编辑与审核` 面板，无需修改其断言。
  - `npx tsc -p config/tsconfig.electron.json`、改动文件 ESLint、Prettier、`git diff --check` 通过（日志 `13-typecheck.log`、`14-eslint.log`、`15-prettier.log`）。
  - 按授权未重跑全量 `npm run check`/`test:desktop`（同代码范围已有通过证据），未打包、未安装、未推送、未调用外部模型或真实业务。
