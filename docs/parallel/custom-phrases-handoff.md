# 自定义快捷回复交接（2026-11-14）

## 设计与实施范围

保留原 80 条内置话术、搜索与 ID 复制、AI 最多三条静态参考的所有行为。QuickReplyDialog 新增“我的店铺话术”页签，内部 QuickReplyCustomLibrary 完整连接模块 services → shared 平台适配 → 专用 IPC 契约。自定义内容不注入 AI 系统参考，不直接发送。支持新建、编辑草稿、确认删除、文本搜索、JSON 预览追加导入、下载 JSON 导出、已保存 ID 显式复制。每店最多 500 条，标题 80 字、场景 40 字、正文 4000 字；导入文本最多 2,000,000 字符，严格版本/字段校验，导入完全相同内容去重，失败不部分写入。

采用项目已安装 Zod 4.6.7（MIT，https://github.com/colinhacks/zod）与现有 Element Plus / Vue；无新增依赖。对比 https://github.com/sindresorhus/electron-store （MIT、当前 11.0.2、近期仍维护）：其 ESM-only/额外 conf 与 JSON Schema 接入对本项目打包为 CJS 和现有 Zod 方案增加成本，故复用项目 electron/assist-window.ts 原子 writeFileSync + renameSync 模式。JSON 写入模式 0600，随机临时文件名，读取损坏或超大文件明确报错并保留原文件。revision 拒绝多窗口陈旧写入。

## 公共装配待统筹接入（本任务没有改公共文件）

1. `electron/custom-phrases-ipc.ts` 导出 `registerCustomPhrasesIpc(runtime: Pick<LocalRuntime, 'snapshot'>, getRoot: () => string): () => void`。注册时传入当前 runtime 和主进程当前账号数据目录下的 `custom-phrases` 子目录，例如 `() => path.join(runtime.dataDirectory(), 'custom-phrases')`。`dataDirectory` 是统筹在 local-runtime 统一提供的主进程方法，返回已有闭包内 `dataDir`（即 managed.dataDir），不能直接使用应用根 userData，也不能暴露给 renderer。如统一从业务装配内部注册，只要回调能引用正确账号 dataDir 即可，不必采用此方法名。
2. getRoot 每次请求在可信 frame、snapshot.workspaceId、店铺归属验证后调用；账号不可用时须拒绝解析目录。local-runtime 已固定当前 dataDir 并在账号切换要求重启，仍应遵守其 canAccessWorkspace 门。勿用渲染层传入路径。若 `snapshot()` 在退出/来源切换时掩码 stores 为空，现有检查会拒绝；统筹接入需保持此行为。
3. **workspaceId 每次启动 randomUUID，仅是 IPC 防陈旧 lease，不可用于持久文件名。** 文件定位为主进程账号 dataDir + SHA256(storeId)。同账号重启应保留，同 storeId 不同账号必须不同根目录。已加入此回归。
4. `electron/custom-phrases-preload.ts` 导出 `createCustomPhrasesPreload(invoke): CustomPhrasesBridge`，统筹在 DesktopApi 增加可选 `customPhrases?: CustomPhrasesBridge`，preload 的 api 对象挂 `customPhrases: createCustomPhrasesPreload((channel, ...args) => ipcRenderer.invoke(channel, ...args))`。不再暴露独立 window 桥；类型定义位于 shared/customer-service/custom-phrases.ts。模块 services 是组件唯一入口，环境访问在 shared/customer-service/custom-phrases-platform.ts。
5. 通道白名单：`custom-phrases:list/save/remove/import/copy`。全部先 `requireAppFrame`。copy 只接受 scope + UUID，读取当前库后复制，不接受任意正文/文件路径，不提供发送。注册返回清理函数，应与 business IPC 一起在退出/重建 runtime 时调用；不要重复注册。

未装配时“我的店铺话术”明确报未加载能力且禁用创建/导入/导出；没有浏览器 localStorage 假持久化。内置话术仍可照常使用。组件响应后端事件检测工作区/店铺变化，隐藏旧列表、清除草稿；请求 ticket 阻止卸载或切换后的迟到数据覆盖。

## 文件清单

- 修改：src/modules/workbench/components/QuickReplyDialog.vue（仅新页签与内部组件）。
- 新增：同目录 QuickReplyCustomLibrary.vue；workbench/services/custom-phrases.ts。
- 新增：src/shared/customer-service/custom-phrases.ts、custom-phrases-platform.ts。
- 新增：electron/custom-phrases-store.ts、custom-phrases-ipc.ts、custom-phrases-preload.ts。
- 新增：tests/custom-phrases.test.ts、custom-phrases-ui.test.ts、custom-phrases-ipc.test.ts。
- 新增：本交接文件。不改公共 HANDOFF/DECISIONS/装配，不操作 Git。

## 验证与剩余验收

- `npx vitest run tests/custom-phrases-ipc.test.ts tests/custom-phrases.test.ts tests/custom-phrases-ui.test.ts tests/generic-phrases.test.ts --maxWorkers=1 --minWorkers=1`：**4 文件 18/18 通过，exit 0（16:13:28，33.19秒）**。覆盖原内置 7 项与自定义持久化、重启、账号目录隔离、并发修订冲突、损坏保留、导入校验去重、preload返回校验、UI编辑/复制/删除确认/导入预览、账号切换隐藏、IPC来源与权限校验。
- 本任务 11 个 TS/Vue 文件的 `npx eslint <具体文件清单>` 通过（exit 0）；只对本任务文件运行 Prettier，未格式化全目录。
- `npx vue-tsc --noEmit -p artifacts/custom-phrases/tsconfig.json` 通过（exit 0）。该忽略产物内配置 extends 根 tsconfig，仅 include 本任务源码/测试、QuickReply 两组件与 src/env.d.ts，保留严格类型规则，并检查它们传递依赖。
- 首次全局 `vue-tsc --noEmit` 当时遇到并行创建中的同步模块缺失导出（StoreSyncView/client）；本任务的店铺字段应为 storeName 已修正，之后使用限定配置成功，未改他人文件。未做全量构建或 Release。

JSON 导入支持选择本机文件或粘贴文本，两者均先预览并显式确认；选择文件不会自动导入。公共接入完成后需真实桌面验证：创建/编辑/重启保留、切店隔离、不同账号同店铺 ID 隔离、复制剪贴板、JSON 下载、关闭窗口重开、退出隐藏旧列表，以及界面截图。未做真实买家发送、平台写入、付费调用或生产部署。当前仍由统筹完成公共装配，不能把夹具测试称为完整桌面或实店验收。
