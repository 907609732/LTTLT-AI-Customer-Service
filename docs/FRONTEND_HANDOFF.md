# 灵兔客服前端交接

接收：钱连军。分工：本仓库交付Figma页面与前端交互；后端实现、鉴权、数据读取及真实执行由接收方接入。

## 启动与构建

Node.js >=22.12（当前验证24），执行`npm ci`。

- 浏览器预览：`npm run dev:web`，访问终端显示的127.0.0.1地址。
- Electron开发预览：`npm run dev`。
- 正式产品默认直接显示页面；画板验收入口`/?design=1`。单页复核入口`/?screen=UX11`等。
- 正式构建在GitHub Actions的“Build and verify Electron frontend”工作流运行。通过后下载`lingtu-windows-frontend-<提交SHA>`产物；Windows可执行文件为`LingtuCustomerService.exe`。
- 本地Windows若运行时位于非英文项目路径，启动脚本自动复用`%LOCALAPPDATA%/electron/Runtime/<版本>`中的同版运行时。保留隔离、沙箱和IPC来源校验。

## 当前设计基准

Figma文件`CR9QYrjZfTfMf6CIBj5yrb`，Canvas`2:129`，右侧可编辑画板。UX01—25为1440×900，UX26—32为300×900。UX05/06、09/10、13是三条长页的续段，业务导航进入UX04、08、12。

`docs/figma-map.json`记录来源ID、尺寸与视觉验收状态；未逐页核对前不设置`visualVerified=true`。原始快照只保存在被Git忽略的`design/snapshots`。页面由React DOM、文字、矢量及局部图片素材渲染，不是整页截图。

## 接入位置

- `src/App.tsx`：正式产品入口、路由、浮层及窗口转接。
- `src/design/FigmaCanvas.tsx`：当前可编辑结构渲染及真实控件接入。
- `src/design/interaction.mjs`：NAVIGATE/CHANGE_TO/OVERLAY/CLOSE/BACK纯状态模型，实例变体相互隔离。
- `src/features/FrontendControls.tsx`：输入、字数、开关、禁用词和定时任务；sourceNodeId可追溯到画板。
- `src/features/drafts.mjs`：按范围分隔草稿与最近成功保存快照，失败保留草稿，旧回执不覆盖继续编辑。
- `src/services/contracts.ts`：`FrontendServices.execute(command)`请求/响应接口。
- `src/services/demo.ts`：当前仅前端演示适配器。接入时替换或向FrontendProvider注入真实实现，不在UI内硬编码服务地址或凭据。

命令包含`action`、`screenId`、`storeId`、`sourceNodeId`、`values`、`requestId`。目前`save-config`和`save-tasks`返回演示保存，其余真实业务返回未接入。真实服务可返回`ok`及版本，或抛出错误；UI只有成功回执后才推进已保存快照。实际门店、会话、账号标识应替换演示上下文`demo-store-001`，不得把它发送到生产服务。

## 待接后端

所有静态店铺、会话、订单、额度与统计均为设计示例。真实店铺登录、跨店同步、AI训练/推理、客户消息发送、定时执行、工单分配/处理、订单及支付、成员认证和权限均未连接。

钉钉《灵兔客服 UX交互功能与开发接入文档》v1.2逐页列出字段与状态约定。Figma未设计展开态的新增/详情业务流程，不应猜测接口或把静态样例当真实结果；由接入方按业务需求补齐对应状态与数据绑定。

## 验证范围

已建立：当前32来源尺寸/节点及导航目标完整性检查、草稿与状态模型测试、32页资源与运行错误检查，以及首页导航、接待菜单、欢迎语保存恢复、图片提示、禁用词和定时任务关键交互检查。

逐页视觉、辅助独立窗口、云端产物及合并提交验收结果会在交付完成时追加。本文件当前不宣称这些尚未执行的检查已通过。

## 本轮交付验证和限制（2026-11-08）

已完成32页Figma导出对照、训练/偏好页面修正复核、53项浏览器检查及29项单元检查；Electron开发预览的主窗口、独立侧栏、导航、IPC和取消/确认关闭通过。视觉核对范围见IMPLEMENTATION.md。

搜索限制：店铺、意图包、工单、质检和成员搜索目前为可编辑输入，尚未绑定业务列表过滤/分页；只有禁用词搜索在当前演示数据上实际过滤。详情、新增等未在Figma设计的业务流程由接收方补齐。以上不列为业务功能验收通过。

设计与交互说明：[钉钉文档](https://alidocs.dingtalk.com/i/nodes/QPGYqjpJYrjrOeLBc9grbY6K8akx1Z5N)。[当前Figma](https://www.figma.com/design/CR9QYrjZfTfMf6CIBj5yrb/AI%E5%AE%A2%E6%9C%8D?node-id=2-129)。[交付PR](https://github.com/907609732/LTTLT-AI-Customer-Service/pull/2)。云端构建及产物以PR检查和[Actions列表](https://github.com/907609732/LTTLT-AI-Customer-Service/actions)为准；未取得成功产物前不视为完成打包验收。
