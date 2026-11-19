# 知识库内嵌主内容区

## 改动

- `/knowledge` 迁入 MainLayout 子路由并传入 embedded 模式，复用主顶栏、侧栏和内容区。原入口、店铺与训练商品预选保持；移除知识页独立窗口控制，提供返回工作台。
- 正式主进程使用 knowledge-window 的内嵌宿主，不创建知识库 BrowserWindow；原上下文 revision、店铺校验、账号租约及恢复/清除重建接线不变。新增主进程至主窗口的固定 `knowledge:navigate` 通知，旧账号或已销毁导航被丢弃。独立窗口宿主保留隔离验收兼容。
- 路由离开先保存草稿，保存期间继续输入会再保存最新内容；保存失败或操作尚在处理中阻止离开。点击店铺须先成功离开知识库，避免原生平台页覆盖失败编辑器；晚到打开结果也核对当前路由。
- 主窗口关闭/Alt+F4 复用原先先保存再关闭握手，只有主窗口可确认 hide。关闭确认只放行一次；导航清除旧关闭意图。捕获 webContents 用于销毁清理，避免窗口销毁后读取失效属性；异步原生 close 由事件消费放行标记。
- 初始化等待期间离开页面时停止注册订阅；卸载清理监听与轮询，后台知识任务不随路由切换取消。

## 验证

- `vitest run tests/knowledge-manager.test.ts tests/knowledge-window.test.ts tests/knowledge-embedded.test.ts tests/knowledge-navigation.test.ts tests/knowledge-close.test.ts tests/main-sidebar.test.ts tests/training-legacy-route.test.ts`：7 文件 76 项通过。
- 完整 `npm run typecheck`、改动文件 ESLint、模块边界检查、Prettier、`git diff --check` 通过。
- `npm run build` 通过，原有 Zod 注释与 chunk 提示保留。一次 Vite 结束时 Node/libuv 退出断言，定位为构建工具退出异常；相同源码重跑完整 build 成功。最终关闭守卫修正后另跑 `npm run build:desktop` 成功。
- 浏览器使用真实 App/MainLayout/router/知识组件及两店六商品模拟桥：知识页高度等于主内容区，无额外整体溢出；独立窗口按钮为 0，切店、返回、再次打开训练 tab 与 p1 商品预选通过。模拟夹具不代表实店/模型验收。
- 真实隔离 Electron hidden BrowserWindow：关闭前拦截，未确认不销毁，保存确认后正常销毁并退出 0。证据 `artifacts/knowledge-embedded-20261119/native-close-result.json` 为 `blockedBeforeAcknowledgement=true, closedAfterAcknowledgement=true`。
- 一次独立只读审查提出原生视图覆盖、主窗口关闭保护及卸载后订阅三项，均修复并增量复核无阻塞。

截图、模拟夹具和原生探针位于忽略目录 `artifacts/knowledge-embedded-20261119/`。未操作真实清除/恢复、模型调用或买家发送，未改正式知识数据。

## 整合

本提交基于先前更新入口提交 `5f07dbf`，不包含整合聊天后续 v1.0.75 侧栏样式修正，整合时保留该修正与现有未提交文件。未自行递增版本、推送或重启正式主目录；继续由既有整合聊天统一源码合入、版本、推送和本机打开验收。用户明确暂不打包，禁止触发安装包/Release 发布。验收条件：正式源码中原入口直接在内容区显示知识库，共用顶栏且能切店/返回，原账号和知识数据保留。
