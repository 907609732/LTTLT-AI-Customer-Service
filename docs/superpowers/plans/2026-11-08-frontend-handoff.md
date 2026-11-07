# Figma Frontend Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 依据最新Figma交付可运行、可交互的Electron前端，合入main并通过钉钉通知钱连军接入后端。

**Architecture:** 保留已有Electron/React工程和安全边界。现有离线图层数据更新为本地插件读取的当前原生设计；React组件与领域状态负责表单、菜单、长页、列表和浮层。异步数据接口隔离演示数据与后端实现。

**Tech Stack:** Electron45.2.3、React19.3.1、TypeScript、Vite、Node test、Playwright。

**Spec:** docs/superpowers/specs/2026-11-08-frontend-handoff-design.md

## Global Constraints

- UX01—25为1440×900；UX26—32为300×900。
- 仅使用Figma“我们的设计方案”右侧可编辑结构；PNG只作视觉对照。
- 32来源组成27个导航状态与5个续段，三条业务长页合并且不重复字段。
- 后端由钱连军负责；本轮不得以演示反馈声称真实平台业务成功。
- 原始快照和敏感数据不进Git；保留组件/节点来源与视觉验收证据。
- 功能分支开发，检查后PR合入main；合并后通知钉钉钱连军。

## Review Focus

- 连续切换店铺或路由时，草稿、已保存快照、筛选和消息输入不能串店或串会话。
- 长文、空列表、输入错误、失败重试和未选会话不能导致控件不可达或假成功。
- 菜单互斥、浮层遮挡和取消关闭应恢复实际来源，不跳到固定示例页。
- 小桌面、大桌面和窄侧栏的操作不能被裁掉；字号不能跟随整页粗暴缩放。
- 演示适配器必须可替换；发送、登录和支付必须保留明确的服务待接边界。

## Task 1: 当前设计结构与来源一致

**Files:** scripts/prepare-design.mjs、src/design/generated/*、docs/figma-map.json、tests/native-design.test.mjs。

- [x] 先增加断言：25个桌面根1440×900、7个侧栏300×900、当前Figma文件ID、正确首屏ID和续段ID；观察旧数据失败。
- [x] 复用已有本地插件JSON_REST_V1导出最新32根、组件变体和浮层，存design/snapshots（忽略）。导出涉及矢量与图片引用，保留本地素材。
- [x] 扩展现有设计预处理，转换到运行时图层并保留ID、约束、变体、反应和滚动。不要另写截图生成页面的工具。
- [x] 重建必要运行时数据，验证资源全部本地、无原软件参考截图、无完整原始快照入库；运行单测、类型检查和构建。

## Task 2: 产品入口、路由与交互运行时

**Files:** src/App.tsx、src/design/FigmaCanvas.tsx、src/design/types.ts、src/design/style.ts、src/design/actions.ts、src/styles.css、tests/e2e/native-screens.spec.ts。

- [ ] 先写E2E：默认不显示设计浏览器；首页进入配置、店铺与商品及辅助中心；三个长页可达末项；侧栏保持300宽；观察当前预览模式不符合。
- [ ] 正式入口直接渲染产品，开发索引使用显式开发入口。共享React图层控件渲染最新原生设计、真实文字/矢量/表单，不铺整页图片。
- [ ] 实现NAVIGATE、CHANGE_TO、OVERLAY、CLOSE、BACK和定时反馈；按组件实例隔离状态，保持菜单互斥、浮层居中与点击遮罩关闭规则。
- [ ] 长页使用最新组合结构和独立滚动；核对看板、转人工、自动操作末段与固定导航。
- [ ] 测试实际导航/变体/浮层及键盘可操作路径，验证未定义服务动作不能返回真实业务成功。

## Task 3: 可编辑表单与数据边界

**Files:** src/features/*、src/services/types.ts、src/services/demo.ts、src/components/*、tests/*state*.test.mjs、tests/e2e/forms.spec.ts。

- [ ] 测试欢迎语草稿/已保存分离、取消恢复、转人工联动保持、定时任务必填/编辑/删除、禁用词解析及店铺隔离。
- [ ] 实现共用Input/Textarea/Select/Checkbox/Switch/Dialog等真实DOM控件和领域状态，以当前Figma节点/字段映射定位；保留设计可追溯性。
- [ ] 按钉钉字段约定定义异步数据类型与演示适配器；失败不清草稿，成功才更新已保存快照。前端数据状态与视觉交互运行时共同驱动。
- [ ] 完成店铺搜索/筛选/分页，转人工、欢迎语、自动操作、图片提示、意图、训练、模型、尺码、禁用词、工单、质检、订单、算力、偏好及成员相关前端动作。未接真实服务的执行行为显示准确状态。
- [ ] 检查长内容、无数据、错误/加载状态、未选会话发送禁用、跨店/会话草稿隔离和取消确认。

## Task 4: Electron窗口与视觉验收

**Files:** electron/main.cjs、electron/preload.cjs、src/design/types.ts、tests/electron-smoke.mjs、docs/figma-map.json、docs/IMPLEMENTATION.md。

- [ ] 写窗口测试：主窗口内容1440×900，辅助窗口300×900，最小化继续保留状态，取消关闭回原状态，确认关闭返回主窗口。
- [ ] 实现最窄权限IPC和窗口生命周期；不扩大Node或网络权限。
- [ ] 逐页将客户端同尺寸截图与当前Figma导出进行视觉对照，修复字号、约束、图标、滚动和遮挡；通过后逐页更新visualVerified，不能批量预置true。
- [ ] 完成typecheck、npm test、build、test:e2e、test:electron；将实际测试与未覆盖边界写入验收报告。

## Task 5: 主干交付与通知

**Files:** docs/HANDOFF.md、README.md、.github/workflows/verify.yml。

- [ ] 文档写明启动命令、页面/组件结构、字段/请求类型、后端替换点、演示数据限制及验收证据。
- [ ] 检查Git暂存内容不含原始设计快照、隐私、凭据或构建缓存；提交功能分支。
- [ ] GitHub运行必要检查，处理review和冲突；按用户授权PR合入main并回读合并提交与检查。
- [ ] 钉钉精确解析钱连军收件人；存在歧义再询问。发送版本、仓库链接、启动方式、交接文档和待接后端清单，核实结果后记录。

## Execution Ledger

- 2026-11-08：独立clone与功能分支已建立；旧基线typecheck、20项单测、build、8项浏览器E2E通过。Electron运行时补装下载中。
- Ruling：用户最新明确本轮只负责前端交付，后端由钱连军接入，因此真实后端联调不作为本轮交付完成条件；必须明确未接入范围，不能伪造成功。
- Ruling：保留现有技术栈与功能分支，先更新原生设计来源再改业务界面，避免在已过期尺寸上重复实现。
- 2026-11-08：builder check无重要缺口。Task1完成：当前213组件定义中32根画板拆分懒加载、181共享组件、188图片引用；54张新增均由本地原生图片字节读取。Task2已实现正式入口及五类交互纯状态模型；24单测、typecheck/build、10项E2E通过。尚未宣称Task2全量交互验收完成。
- Ruling：接收人已由用户明确为钉钉钱连军，合并成功后再发送交接信息；不提前发送未完成声明。
- Electron运行时安装完成。桌面启动检查暴露独立启动失败（进程状态0x80000003）；浏览器检查可继续，桌面问题留到窗口任务定位修复，不能标记Electron验收通过。
