# 客户端与独立服务端验证

## 2026-11-14：本机 HTTP 实际启动

按用户要求不生成、不导入证书。原生管理网页重新构建为 http://127.0.0.1:3000，生成 Windows amd64 可执行文件并实际运行，监听地址已核对为 127.0.0.1。独立 SQLite 位于 server/runtime/local-http；原生 setup API 创建随机密码管理员，未访问生产数据库。

实际账号密码登录成功（管理员 role=100）；使用真实短期令牌读取 self、admin/config、accounts、usage-daily 均返回 200；外部浏览器 Origin 被拒绝 403。用独立 Edge 资料目录实际登录管理网页，概览及每日用量渲染完成，截图 artifacts/local-http-admin.png 已查看。没有配置供应商 Key、发起真实模型请求或发送买家消息。第二次启动实际验证沿用原进程与账号，不重置密码。

完整 npm run check 再次通过（81 项单元、229 项上游回归、类型/静态/格式/来源与构建）；桌面 78/78 再次通过。Go 9 个目标包回归通过；补充本机 HTTP 来源、开关、监听、peer/Host/Origin 边界测试，最终 lingtuhost/middleware 复验通过（同一命令中的 router 正则无匹配，不计作新测试）。日志 local-http-check.log、local-http-desktop.log、server-local-http-go.log、server-local-http-final-go.log、server-local-http-web.log 与 server-local-http-build.log 在 artifacts；真实服务鉴权记录 server/artifacts/local-http-runtime.json。

旧版桌面窗口关闭后后台未在 15 秒内退出，核对 PID/可执行路径后结束该旧进程并启动当前构建；实际窗口标题“工作台 · 云朵客服”，进程响应正常、启动错误日志为空，原有用户数据目录保留。D 盘构建缓存空间不足时，本次 GOCACHE/GOTMPDIR 切到 E 盘专用目录，未删除其他项目文件。前一节 Linux 二进制和网页 SHA 是当时产物；本次 Windows 程序与 HTTP 网页为新构建，不能混用旧摘要。

## 2026-11-13：PR #21 服务端合并及双模式自测

本轮实际执行，不用源分支历史 CI 替代本机结果：

- `npm run check` 通过：15 文件 / 81 项项目单元、229 项上游回归、Vue/主进程/服务端工具 TypeScript、ESLint/模块边界、格式、80 个运行时与 92 个服务端来源文件 SHA256 校验，以及 Vue/Electron 构建。
- `npm run test:desktop` 最终 78/78 通过。新增 3 项走真实 Electron/safeStorage、临时工作区和回环 HTTP 协议夹具：设备授权后要求切换账号工作区、重启恢复加密会话、托管训练实际请求与 trace、通用话术仍入上下文、真实刷新后的已用 1/剩余 19、请求结果不确定不重发、原请求编号与服务端账本请求一致、必须明确核对才清除提示、退出后隐藏旧 trace。已有逐条确认与模拟台检查继续通过。
- `npm run server:verify` 本机通过：固定 New API 源码重新准备；9 个目标 Go 包在隔离 SQLite 中回归；2 项生成/翻译覆盖检查；原生网页 1,428 文件 / 2 项目类型检查、改动范围 lint、7 文件 / 36 项托管与认证前端测试；管理网页与 Linux amd64 服务构建成功。
- 原生网页 1,846 个产物逐文件 SHA256 校验，物理构建缓存与 `server/.upstream/web/dist` 内容一致。二进制 `server/bin/lingtu-managed` 为 ELF64 / amd64，163,482,260 字节，SHA256 `7b6eca049fa3dfb35f24cf994d23bcd593729a77d5329e76bf72ffa477cb34ae`；附 `NEW-API-LICENSE`。

截图已查看：`artifacts/desktop/managed-account-settings.png`、`managed-request-review.png`。最终发现并修正验收的异步路由时序：did-finish-load 不代表 Vue 已挂载，在有界时间内等待真实节点，保留原有空页/错误断言；最终完整桌面复跑通过，没有覆盖基准来掩盖差异。

Windows 工具链适配：本机旧 Bun 1.3.14 出现安装崩溃，改用固定 1.4.4；加密目录/跨盘连接使 bin 链接失败，改在专用未加密物理缓存构建；为子进程显式加入同一个 Bun 的 PATH，避免 typecheck 脚本误用旧全局版本。使用 `YUNDUO_SERVER_BUILD_DIR` 与 `BUN_INSTALL_CACHE_DIR` 指定可再生构建目录，最终产物回写 server；不修改全局工具配置或生产服务。

证据：`artifacts/managed-full-check.log`、`managed-desktop.log`、`server-verification-complete.log`；`server/artifacts/verification.json`、`web-copy.json`、`binary.json`。服务端 JSON 仅在实际步骤全部返回 0 后写 passed。测试不使用生产账号、真实模型 Key 或买家会话，不发邮件/真实买家消息、不部署线上。没有在本机运行 MySQL/PostgreSQL 或 -race，不声称完成 28 家厂商与线上 OAuth/SMTP 验收；Linux 二进制已构建，未在本机 Windows 上运行该 Linux 服务。完整范围与运行约束见 MANAGED_SERVICE.md、server/README.md。

## 2026-11-13：内置通用客服话术

完整 `npm run check` 通过：14 个测试文件、77 项单元、229 项上游回归，TypeScript、ESLint/模块边界、Prettier、80 个固定上游源码完整性和 Vue/Electron 构建均通过。新增 7 项单元覆盖精选来源/字段、文字召回、实际 AiClient 请求与 trace 一致、原店铺知识保留、买家文字不升级为系统指令、图片/无匹配不沿用旧参考、16K/8K 压缩计量、已知 ID 复制及失败呈现、界面搜索与复制交互。

`npm run test:desktop` 75/75 通过。新增桌面检查实际打开「快捷回复」并确认 80 条、10 场景中的筛选结果、搜索单条、适用条件、空态和未知复制 ID 拒绝；使用同一本机运行时执行「物流不动了」训练，核对实际本机 HTTP 请求及 trace 含 `[通用客服表达参考]`，短上下文仅产生原有的一次模型调用。不可信窗口复制同样拒绝，原有确认/取消/过期/发送回归保持通过。

截图：`artifacts/desktop/generic-phrases.png`、`generic-phrases-search.png`，均已查看。截图检查发现多卡片会被 flex 列表压缩，已将卡片设为不收缩、由列表独立滚动；最终桌面检查同时断言首卡正文/适用条件不超出卡片边界、列表实际可滚动。截图等待弹窗进入动画结束。日志：`artifacts/generic-phrases-check.log`、`generic-phrases-desktop.log`。自动验证只使用临时数据和合成对话，不修改日常店铺数据、不读取或改动系统剪贴板、不调用真实付费模型、不向真实买家发送。剪贴板成功/失败的界面单元使用受控测试替身；桌面只验证未知 ID 与不可信窗口拒绝，不把这项说成真实用户剪贴板成功验收。真实语义匹配效果和本店业务结论仍需用户在训练场核对。

维护及约束见 GENERIC_PHRASES.md。本次未更改 vendor、模型凭据、店铺 AI 开关或审批发送策略。

2026-11-13 本机模拟店铺与模拟顾客页：npm run check 通过（13 个测试文件 70 项单元、229 项上游回归、类型/静态与依赖边界/格式、80 个上游文件完整性及渲染层与 Electron 构建）；基于本次构建的真实 Electron 验收 73/73 通过（基线 63），其中新增 9 项模拟店铺检查加 1 项模拟客服台路由截图。覆盖「添加店铺」里可选「本机模拟店铺」且必须填店名、未打开前不报告模拟服务已运行、打开后只监听 127.0.0.1 且带一次性口令（无口令页面 403、接口 401、错误口令 401、CSP 为 default-src 'none'）、顾客页以顾客身份发的消息经真实采集监控进入供应商会话、桌面端确认后 send-reply 一次写入线程且 data.confirmed 为 true、关闭店铺后回复被拒绝并重新打开恢复、`/sim` 客服台显示店铺与已确认回复、侧栏「开店准备 → 模拟客服台」入口（`/shop/manage?panel=sim`）与 `/sim` 两条路径都能打开同一界面。模拟顾客页默认三人设（小雨／阿哲／陈女士）与完整问答在截图里可见。截图 artifacts/desktop/sim-customer-page.png、sim-console-ready.png；日志 artifacts/check.log、artifacts/desktop-run.log。顾客页截图先等到默认顾客和会话真的渲染完再截取，而且聊天记录必须在 role="log" 区域核对，不用左侧会话摘要冒充已打开会话。全部使用本机合成数据与临时工作区：没有真实平台登录、没有向真实买家发送，页面自身写明「不代表真实平台」。新增单元 tests/simulator.test.ts 覆盖中枢认领/持久化、适配器失败枚举、模拟管理器状态、服务口令与参数校验、顾客资料增改删、以及顾客页在店铺尚未打开时也能看到默认顾客（避免页面显示「还没有顾客」误导用户）。

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
