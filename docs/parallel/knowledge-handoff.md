# 知识学习 / 尺码资料交接（2026-11-14）

## 实际根目录与范围

本次真实源码根目录为 `E:\~1awucheng\Plastic SCM\AI电商客服软件\client`。未采用文档中的旧 F: 路径；已读取根 AGENTS、CONSTRAINTS、ARCHITECTURE、HANDOFF、LOCAL_INTEGRATION 和模块 README。按本次委派范围，不提交、推送、切分支、发布；不改公共装配或其他并行工作区改动。

## 实现

- `src/modules/knowledge/learning.ts`：本店相邻已采集买家/客服纯文字转候选；本机启用商品规格转候选并绑定商品；明确“问：/答：”文本转候选；尺码候选转停用知识包。来源包含店铺、会话及消息时间，或商品 ID/版本/更新时间，或文档名/起始行，或人工尺码来源名称。
- `services.ts`：复用 `list-products`、`list-intent-packs`、`save-intent-pack`。不发明采集 URL/新平台协议。保存前重复检查、显式确认、同服务并发防护、异步查询后的工作区/店铺有效性校验。
- `components/ShopIntentLearnPanel.vue`：取代暂未上线页，提供已有聊天、商品规格与文档文本候选预览，明确数量和不完整范围。
- `components/ShopKbPanel.vue`：取代不可用的还原占位表单，提供店铺、必填商品编号、来源名和尺码内容；预览后经过相同审核流程。保留根节点 ID 和旧样式属性，没有改 legacy CSS。
- `components/LearningReview.vue`：来源、原文、可修改答案、确认复选框、入库状态；修改答案撤销确认，切店铺/工作区清空候选选择；新建包默认停用，不覆盖旧知识。
- `components/ShopIntentPanel.vue`：只读展示来源审计；保存时强制保持审计条目停用，避免其参与接待检索。已有知识包编辑/启用/删除路径继续复用。
- 模块 README 与三份专用测试更新。

## 来源存储与实际限制

现有 IntentPack 的 `source` 只接受 quality 纠错来源，不能冒充支持采集来源。因此不写该字段，而使用固定问法 `【学习来源审计，请保持停用】` 的停用条目保存 `lingtu-learning-v1` JSON（source/original/reviewed/productIds）。来源和原始问答与人工修改分开保留；跟随既有意图文件、版本冲突检查和 JSON 导出，不加新数据库。该审计是可维护资料，不是不可篡改日志；手工 JSON 导入仍需核对来源条目保持停用。

审计条目受上游答案 4000 字容量限制，原文+审核内容+来源超限明确拒绝，不截断。已有包最多 100 个，本流程一个候选一个包，因此也受此容量限制；保存失败保留候选。重复检查是同服务串行和保存前查询，不构成跨窗口原子唯一约束。现有事实允许并存，须人工检查冲突。

商品仅查询第一页最多 100 个已有本机商品，页面展示 loaded/total；不会声称全部商品。聊天仅当前快照最多 100 组相邻纯文字，不主动加载全量历史。候选来源是预览时版本快照，确认不会重新向平台采集；即使原资料后来改变，仍保留预览版本供人工判断。

## 复用与选型

复用固定上游 `vendor/lingtu-runtime/electron/intent-knowledge.cjs`（AGPL-3.0-only，许可见上游 PROVENANCE）与项目已安装 Zod 4.6.7（MIT），没有修改 vendor 或引入依赖。检索对比 [NLP.js](https://github.com/axa-group/nlp.js)（MIT，意图分类/训练框架）与 [Zod](https://github.com/colinhacks/zod)；本任务不需要分类训练服务，现有知识检索已满足审核后接待调用，额外框架增加接入成本且不解决来源确认。通过 Context7 核对锁定 Zod v4.6.7 的对象剥离、parse/safeParse 和长度校验行为；成熟方案近期可访问，但未对 NLP.js 做运行兼容性或维护活跃度承诺。

## 公共接入与统筹建议

没有改 main/preload/business-ipc/local-runtime/shared contracts/app router 等公共文件。现有 `panelRegistry['intent-doc']`、`['intent-chat']`、`['kb']` 已指向本模块组件，模块 index.ts 已导出，因此三个页面可通过既有入口运行，无新增 IPC 或生命周期注册。

`panelRegistry.learn` 目前仍是 quality 的 ShopWipPanel，不能把此交付描述为后台自动学习任务已完成。如果统筹希望“学习任务”入口展示本次人工候选流程，可在公共 navigation.ts 将该键映射到已导入的 ShopIntentLearnPanel，并调整名称；这只是导航建议，不代表后台定时/自动采集已接入。

来源字段长期应升级为受主进程验证的结构化 schema 与独立审核记录；如未来需要跨窗口原子去重、全量分页、持久化待审核任务或尺码唯一绑定，应由统筹扩展正式契约与主进程服务，不能推断私有平台接口。

## 验证

最初运行新增候选测试时因 learning.ts 尚不存在失败，随后实现并验证。

- `npx vitest run tests/knowledge-learning.test.ts tests/knowledge-learning-service.test.ts tests/knowledge-learning-ui.test.ts --maxWorkers=1 --minWorkers=1`：3 文件、13/13 测试通过；6 个上游持久化/服务测试、4 个 Vue 界面测试、3 个候选生成测试。
- 专用 `vue-tsc` 配置仅 include `src/env.d.ts`、`src/modules/knowledge/**/*.ts`、`src/modules/knowledge/**/*.vue` 和上述测试，继承项目严格配置：通过（临时配置验证后移除）。
- 改动文件 ESLint：通过。Prettier 仅操作本任务文件，检查通过。
- 曾运行全项目 `vue-tsc --noEmit`，当时被其他并行模块尚未创建的 sync 文件和 custom-phrases-platform 的 LocalStore.name 类型错误阻塞；没有修改其他领域来消除这些错误。知识范围类型检查通过，不能据此声称全项目通过。

测试覆盖真实上游临时文件持久化/重载、默认停用不检索、启用后店铺与商品隔离、来源条目不召回、原文和审核文本保存、同来源去重、连续点击、跨账号失效、审核编辑复选框失效、来源只读和入口渲染。数据均为合成夹具，未调用付费模型或真实平台。

## 未验收

没有操作真实平台浏览器、发送真实买家消息或修改实店商品。真实 Electron 界面及跨进程链路已在下节完成专项验收；实店端到端验收、真实模型答案质量、Release 构建和全量检查仍未做。PDF/Word/OCR、任意文章自动转问答、后台自动学习任务、跨店尺码共用与互斥绑定未接入。真实发送依然走统一逐条确认门。

## 续做：真实 Electron 界面验收（2026-11-14 16:30，上海时间）

用户明确要求继续走完候选预览、人工确认入库和启用后检索，发现问题直接修复，先不发布。本轮新增 `electron/knowledge-electron-check.ts` 和 `scripts/verify-knowledge-electron.mjs`，复用现有 desktop smoke 的窗口、preload、业务 IPC、本机运行时和本机 HTTP 测试模型方式，不新建业务 IPC。没有改公共装配文件，也没有重启或停止用户正在使用的实例。

### 发现并修复

真实窗口首次操作时，读取知识列表触发正常快照刷新后，已选候选消失。根因是三个页面的 `watch(() => [id, workspaceId, ...])` 每次快照替换都返回新的数组引用，实际 ID 未变化也执行了清空逻辑；确认入库内部的 `list-intent-packs` 同样会刷新快照，因此会阻断真实保存。旧界面测试反复返回同一个 snapshot 对象，漏掉该行为。

在 `LearningReview.vue`、`ShopIntentLearnPanel.vue` 和 `ShopKbPanel.vue` 改为 Vue 多来源 watch 数组，分别比较实际来源值。只有候选列表、店铺 ID、工作区 ID 或尺码输入真的变化时才清空。新增“同工作区全新快照仍保留审核且可完成保存”的回归测试，先看到断言失败，再修复后通过。仍保留实际切换工作区和店铺时的失效保护。

截图还显示通用表单 label 的 grid 样式使确认框与说明断行，已在 LearningReview 中局部修正为同行展示并允许长文本自然换行；新增答案输入 aria-label 供读屏及稳定定位。没有修改全局/legacy 样式。

### 实际验收结果

最终命令：`node scripts/verify-knowledge-electron.mjs`，退出码 0，**10/10 原生场景通过**。真实 Electron 43.8.9 / Chromium 150.0.7871.250 窗口加载完整 Vue 应用，通过真实 preload/IPC 使用隔离运行时；仅初始化店铺、商品和归档夹具时通过已有业务命令/合成归档落盘设置前置条件。预览、编辑、勾选确认、入库、启用和训练操作均在真实渲染页面触发表单/按钮，未替换平台桥或业务服务。

1. 独立临时目录创建甲乙两间本机模拟店、一个商品、一组已归档合成买家/客服文字；模型为仅监听 127.0.0.1 的测试服务，无真实密钥。
2. 文档候选预览不写入知识；未勾选确认不能保存；编辑后撤销原确认；人工确认后真实落盘停用包，原文与修改后答案分别保留。
3. 停用包的答案标记未进入训练模型请求；通过意图页开启知识包并保存后，该答案进入真实训练请求的知识上下文；来源审计 JSON 始终不进入模型请求。
4. 当前归档聊天候选预览显示会话来源，人工确认并启用后，聊天答案进入训练请求。
5. 本机商品规格候选带商品 ID、版本和更新时间；修改审核答案并入库、启用后，指定商品训练请求含修改后的知识答案。
6. 手工尺码按本店商品绑定，预览、确认、启用及检索通过；未指定商品时不会召回该商品专用尺码答案。
7. 同来源、同审核问答重复入库显示错误，包总数保持 4，审核草稿保留可继续修改。
8. 切到乙店时旧候选失效；乙店训练请求没有甲店四类知识。所有模拟店铺的 AI 和打开状态始终关闭，没有待发送回复。
9. 仅重建隔离运行时后，4 个已启用包及停用来源审计仍在，训练请求再次召回文档知识。
10. 渲染页 Vue 错误和 console error 均为 0；总计 9 次本机 HTTP 测试请求（包含一次模型配置连接探测）。固定模型只回复“已收到测试请求”，检索结论依据请求中的唯一答案标记，**不宣称真实模型语义或答案质量已验收**。

最终报告：[report.json](../../artifacts/knowledge-electron/evidence/2026-11-14T08-30-16-766Z/report.json)。同目录 `model-requests.json` 保存合成请求证据，`isolated-intent-knowledge.json` 保存合成知识落盘证据；未保存请求头或用户凭证。

已打开核对的真实截图包括：[文档候选与确认门](../../artifacts/knowledge-electron/evidence/2026-11-14T08-30-16-766Z/01-document-preview.png)、[启用包的来源审计](../../artifacts/knowledge-electron/evidence/2026-11-14T08-30-16-766Z/03-document-enabled-audit.png)、[商品候选](../../artifacts/knowledge-electron/evidence/2026-11-14T08-30-16-766Z/06-product-preview.png)、[尺码候选](../../artifacts/knowledge-electron/evidence/2026-11-14T08-30-16-766Z/07-size-preview.png)、[重建运行时后训练](../../artifacts/knowledge-electron/evidence/2026-11-14T08-30-16-766Z/08-restarted-training.png)、[重复入库拦截](../../artifacts/knowledge-electron/evidence/2026-11-14T08-30-16-766Z/09-duplicate-rejected-draft-retained.png)。截图位于可滚动页面的实际审核区域，确认按钮与来源内容已人工查看。

### 验收构建环境与复现

- 所有构建写入 `artifacts/knowledge-electron/dist` 和其 `dist-electron`；不覆盖根 dist、dist-electron/main.cjs、用户数据或统筹的共享构建。vendor 是仅指向原 vendor 的目录联接，脚本核对真实目标；未复制或修改第三方源码。
- 标准压缩构建两次在 esbuild 删除系统临时文件时出现 Access is denied。验收使用 `--target esnext --minify false` 成功构建，适用于本机 Chromium；没有修改正式 Vite 配置，也不能据此声称压缩版 Release 已通过。
- 工作卷内 electron.exe 在 JS 执行前退出 `2147483651`；机器已有 `%LOCALAPPDATA%/LingtuRuntime/electron-43.8.9/electron.exe` 可用。脚本核对其版本目录及可执行文件 SHA256 与项目依赖一致后复用现有运行时，没有安装新运行时或关闭沙箱。没有把未证实的退出根因认定为某个具体系统组件。
- 原生控制台仍有 Windows 网络通知 `WSALookupServiceBegin 10108` 和沿用 smoke 旧 console-message 参数的弃用提示；本机请求及页面检查均通过，未改系统网络设置以隐藏这些提示。
- 完整复现使用 `node scripts/verify-knowledge-electron.mjs`；仅在隔离 renderer 已构建且源码未变时，可加 `--reuse-renderer` 重跑原生检查。每轮证据写入独立 UTC 时间戳目录，报告中的时间转为上海时间为本节标题时间。
- 最新单 worker 增量 Vitest：**3 文件 14/14 通过**。范围包含原 13 项与本次快照回归。知识源码、测试及本次原生检查入口的专用 vue-tsc 严格检查通过；本次文件 ESLint 和 Prettier 通过。未跑全量检查、未打包、未发布。
