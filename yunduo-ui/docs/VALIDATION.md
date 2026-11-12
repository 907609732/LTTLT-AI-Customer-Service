# 本机密钥版本验证

2026-11-12 聊天上下文修复：完整检查通过，新增最后一项请求正文回归后复查类型、改动文件静态/格式并运行全量单元 46/46；上游回归 229/229，Electron 63/63。覆盖平台历史失败仍读取归档、35 条旧聊天不被 20 条窗口截断、买家和客服双方参与、同用户不同店铺隔离、最新归档更新、跨来源去重排序且不修改原归档、不同真实 ID 同文保留，以及实际 AiClient HTTP 正文与调试 messages 一致。真实 StoreWorker 生成前零发送和既有确认门继续通过。日志 artifacts/context-history-check.txt、context-history-unit.txt、context-history-desktop.txt；均为合成数据和本机模型夹具，真实平台尚未重新发送验收。上下文上限与后续采集任务见 CONTEXT_COMPRESSION.md。

2026-11-12 买家消息 AI 诊断与回复间隔：npm run check 通过（41 项单元、229 项上游回归、类型/静态/格式/来源完整性及构建）；本次构建 Electron 63/63 通过。新单元验证未开启 AI、60 秒等待及改 0、人工接管来源、历史未知、真实请求先于日志、相同文字不同真实消息 ID 隔离、原地更新不刷屏、准备与实际提交/生成/确认/发送阶段，以及新消息替代旧候选后继续生成的漏回复回归。桌面验证真实设置表单 60→15→0、越界/旧值拒绝、恢复值及重新加载，买家日志历史未知状态和截图；后端重建检查继续通过。截图 reply-pacing-settings.png、message-ai-diagnostics.png 已查看，分别展示可见表单及消息下的状态说明。日志 artifacts/message-ai-check.txt、message-ai-desktop.txt。自动测试没有给真实买家发送；本机只读排查确认存在 60 秒设置，不从历史缺失 trace 推断过去一定未调用模型。

2026-11-12 日志降噪与 AI 计时：npm run check 通过（34 项单元、229 项上游回归、类型/静态/格式/源码完整性及构建），真实 Electron 61/61 通过。单元验证 100 条正常轮询限流事件不进入用户日志、实际异常仍保留；耗时完成后不随发送结果变化，真实 AiClient 用延迟夹具验证计入上下文准备和模型响应。桌面验证 startedAt/completedAt/durationMs 随实际后端结果返回，日志上下文区显示 AI 回复耗时；已查看 context-compression.png 中回复与摘要的分别计时。日志 artifacts/log-timing-check.txt、log-timing-desktop.txt；未增加真实付费调用或买家发送。

2026-11-12 逐字输入：npm run check 通过（31 项单元、229 项上游回归、类型/静态/格式/完整性及构建）。最终构建 Electron 61/61 通过，新增 4 项验证输入事件的逐字前缀、组合 emoji 完整、输入期间切换买家/新增消息/停止 AI 不点击发送；原人工草稿、人工改字、长正文完整回显和单次可信点击测试继续通过。夹具显式加速至 1ms，生产仍为 50ms/字素，未使用真实店铺发送。日志 artifacts/typing-check.txt、typing-desktop.txt；计时与草稿边界见 RUNTIME_LOGS.md。

2026-11-12 确认误拦截修复：npm run check 通过（31 项单元、229 项上游回归、类型/静态/格式/完整性及构建）。最终构建 Electron 57/57 通过。新增复现覆盖历史接口不可用仍按生成前网页基线确认、归档消息 ID/时间补全不失效、临时不可读保留候选待重试、真实新增/重复同句/页面或买家变化拒绝、原引擎记录网页基线且确认后一次发送。离线真实 PDD hook v7 与适配器还验证网页重绘不误判、禁用历史 fetch 后仍可明确确认并点击发送一次。最初测试夹具赋值返回函数导致 Electron 无法克隆，已修正为返回 undefined 并重跑全桌面验收通过；没有通过跳过生产检查修复。日志 artifacts/approval-fix-check.txt、approval-fix-desktop.txt；没有向真实买家发送消息。用户实店需重启、恢复会话 AI 后生成新候选再验收。

2026-11-12 上下文压缩：npm run check 通过，27 项单元、229 项上游回归及构建完成；基于该构建的 Electron 56/56 通过。新增单元覆盖 16,383 不触发、16,384 触发，系统/最近原文/图片保留，长摘要收紧至不超过 8,192，保护内容过大及摘要失败时停止，任务取消，真实 AiClient 先摘要后回复及实际 trace 对应。新增桌面用本机 HTTP 检查真实后端长训练请求恰产生摘要及最终回复两次调用，最终正文不超过 8K 估算，并在日志 UI 展示压缩统计。日志 artifacts/compression-check.txt、compression-desktop.txt；截图 artifacts/desktop/context-compression.png。未调用付费模型或发送买家消息；不同模型 tokenizer、图片成本及摘要准确性按 CONTEXT_COMPRESSION.md 的边界验收。

2026-11-12 拼多多网页按钮发送：npm run check 通过（21 项单元、229 项上游回归、类型/静态/格式/源码完整性检查与构建）。构建后 Electron 验收 55/55 通过，包含新增 6 项离线真实网页测试：浏览器内部可信按钮点击仅一次、超过 900 字正文完整回显、无键盘发送事件、缺少按钮不发、人工草稿不覆盖、输入被改写不发、错误买家不发、无回显不重试。实际执行 PddWebAdapter、云朵 TypeScript 发送策略和 v6 页面 hook，未使用真实店铺或买家。日志见 artifacts/dom-check-final.txt、artifacts/dom-desktop.txt，详细报告仍在 artifacts/desktop/report.json。真实平台权限及页面版本需另行验收。

2026-11-12 实时日志与人工确认：npm run check 通过，21 项单元、229 项上游回归及构建通过；随后运行本次构建的 Electron 验收，49/49 通过。新增检查覆盖 /logs、标题栏入口创建实际置顶窗口、重复打开复用、关窗保留记录、未知候选拒绝，以及实际模型请求上下文与知识/模型名/返回值的对应关系和密钥隔离。真实 StoreWorker 单元验证欢迎语装饰后的正文确认前零发送、确认一次发送一次、拒绝及等待时停 AI 不发送；协调器还验证新消息、人工回复、不可读历史、重复批准和退出作废。

本轮日志：artifacts/review-check.txt、artifacts/review-desktop.txt；截图：artifacts/desktop/dashboard.png、logs-floating.png。截图确认日志入口位于“模型”左侧，独立窗口显示确认、日志和上下文标签，蓝白布局正常。全部使用合成消息及本机模型，没有登录实店或给真实买家发送；真实消息采集与平台发送仍由用户测试店铺验收。使用和维护规则见 RUNTIME_LOGS.md。

2026-11-12 识图兼容修订：已取消本机模式的特定模型名称白名单。npm run check 通过（12 项单元、229 项上游回归及构建）；基于该构建的 Electron 验收 47/47 通过。桌面用自定义 fixture-custom-multimodal 模型名完成配置、开启每店识图与图片训练，断言实际模型名和 image_url 输入，验证页面无 Qwen 专用提示。已检查 artifacts/desktop/image-current-model.png，布局保持原样，提示改为使用当前模型。日志见 artifacts/vision-check.txt 和 artifacts/vision-desktop.txt；未使用真实凭据或付费模型。

日期：2026-11-12。最终本机接入验证已通过：npm run check 完成类型、静态与依赖边界、格式、80 个上游文件完整性、项目单元测试 10 项、上游回归 229 项及构建；随后基于本次构建运行真实 Electron 桌面验收，47/47 通过。汇总检查输出在 artifacts/local-check.txt，最终桌面日志在 artifacts/local-desktop-final.txt，桌面报告在 artifacts/desktop/report.json。

新增桌面检查从真实 Vue 界面添加店铺、保存商品、配置本机模拟模型并测试，验证 CSV 预览不写入与版本冲突、分店隔离、训练知识上下文与图像 parts、规则绑定、欢迎/识图设置、本机工单、服务重建回读、AI 启动关闭、离线草稿、纠错保存和不可信窗口拒绝。全部使用临时工作区和合成数据，没有真实店铺登录、付费模型请求或买家发送。

上游源码完整性通过固定 source-files 清单检查；保留第三方原始测试与许可证。未接入能力和真实验收边界见 LOCAL_INTEGRATION、HANDOFF。

## 初始架构基线（此前记录）

日期：2026-11-12。环境：本机 Windows，Node.js 26.7.0、npm 11.19.0、Electron 33.4.11。

## 检查结果

- `npm run check`：类型、静态与架构边界、格式、单元测试、渲染层及 Electron 构建通过。
- 收尾交互修改后，再次运行 `npm run typecheck`、`npm run lint` 与 `npm test`。
- 单元测试：3 个测试文件、7 个用例，覆盖坐标与链接校验、演示服务隔离、模块边界和二维码弹窗。
- 桌面验收：39/39 通过，使用实际窗口工厂、preload 和 IPC 处理器。

桌面检查覆盖 13 个原有路由、21 个配置视图、旧路由与未知路由重定向、登录输入与模式切换、未接入登录不跳转、弹窗默认关闭与打开关闭、导航不触发占位提示、真实窗口拖动、非法参数、外链拒绝及渲染层无法访问 require。

每个桌面用例通过独立文档隔离；避免仅修改 hash 时沿用上一用例的弹窗和提示状态。测试失败返回非零退出码。非法外链负向用例会在 Electron 主进程打印预期拒绝信息，报告仍以断言结果为准。

报告：`artifacts/desktop/report.json`。截图：同目录各路由 PNG。汇总检查输出：`artifacts/check.txt`。这些为本机忽略产物，不替代本记录或版本提交。

## 界面检查与限制

已查看工作台和配置中心截图：保留蓝白主题、标题栏、侧栏、工作台卡片与配置面板布局；将原“示例文本”等内容调整为明确的演示或未接入状态；店铺列表展示空状态，品牌与二维码可见。

不声称已逐像素验证全部深层弹窗；后续修改具体业务时继续检查相应界面。还原 CSS 继续保留，原 CSS 语法警告已修复。构建仍有现有依赖主包超过 500 kB 的体积提示，属于后续按需加载和样式拆分任务，构建正常通过。

未验证真实业务接口、生产后端、真实平台授权、消息收发、支付、生产安装包、签名和自动更新；这些功能未接入。
