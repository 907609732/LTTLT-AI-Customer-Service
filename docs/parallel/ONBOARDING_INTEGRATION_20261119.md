# 新店引导主线整合复核

## 来源与范围

用户已在功能聊天批准八步引导计划，并要求由既有整合聊天统一版本和合入，本轮不构建、不打包。整合基线 7115311（1.0.86 训练场修复），仅挑入 7eb95fb 与 2e6bd2a。整合后的来源提交为 3fb185e、8a7b954；版本和锁统一为 1.0.87。

Codex 检查了两项提交的源码差异、功能交接、既有独立审查结果和实际测试记录；没有重复实现。只扩展原 presentStore 的可选固定布局枚举，主 frame/严格 schema 边界保留，不允许渲染层传任意坐标。旧 preload 通过能力标记回退，避免新前端覆盖平台登录页。知识学习提交仍复制字符串 ID 数组，不能夹带 Vue 代理对象；训练场组件与回归没有被本次分支覆盖。

## 整合验证

- 合并后的 10 文件 112 项定向测试全部通过：shop-setup、shop-setup-reuse、knowledge-onboarding、main-sidebar、add-shop、onboarding-layout、shop-setup-wizard、shop-setup-reuse-wizard、shop-setup-reuse-review、knowledge-training。单 worker 执行，无真实买家或模型调用。
- Vue 与 Electron `--noEmit` 类型检查通过。
- 模块依赖边界检查通过；vendor 原始来源与实际文件哈希检查通过，固定提交未改。
- 上游 242 项结果来自功能提交中相同 vendor 内容的已完成验证，复用该结果，未再次运行全量上游。
- 既有功能聊天的独立审查和 1280×720 / 1440×920 合成前端预览为同一组件源码，未将合成预览视为真实平台或原生布局验收。

整合证据：`artifacts/onboarding-integration-20261119/`。执行者证据：独立工作树 `billing-support-20261119/client/artifacts/onboarding-20261119/`。

## 运行状态与待验收

未构建前端或主进程、未打包、未推送、未部署，未主动重启当前桌面。当前 Electron 主进程为已启动的 1.0.86，继续使用原认证和业务目录；1.0.87 是待编译源码版本。源代码热更新不代表新主进程/preload 已经生效。

后续用户允许源码编译后，才验收新原生留顶、严格 IPC 枚举及真实扫码后的名称回填。真实采集与模型学习仍需范围及额度确认。当前不新增店铺、不打开 AI、不开始导入或学习、不恢复旧待确认任务。保留主目录两份既有 AGENTS 未提交修改。
