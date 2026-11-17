# 客户端与独立服务端验证

## 2026-11-18 维护性清理与职责拆分（1.0.56，分阶段验证）

本批由本机 DeepSeek 在两个独立工作树分别完成清理/知识拆分和主进程装配拆分，Codex 独立复验并整合；以下为各阶段实际执行证据，合计 26 文件 229 项，不表示整合后全量回归通过。本机未运行全量 `npm run check`、全量桌面或上游套件；云端全量结果见下方最终回执。自动验收未启动真实店铺、未调用真实付费模型、未向买家发送。

- 第一批（清理与文档）：基线三文件 10 项、修改后 3 文件 15 项通过；`npm run typecheck`、`npm run build:desktop`、`node scripts/check-boundaries.mjs`、`git diff --check` 退出 0。原生仅运行旧 `/shop/home` 兼容检查 1/1 通过，报告与截图在 `artifacts/desktop-selected-1794931660094/shop-home.png`，Codex 已目视核对跳转后的数据看板面板。首次并发 Vitest 遇 Windows 临时文件 EBUSY，单 worker 重跑通过；一次漏 `.mjs` 导出声明导致 TS 失败，补充 `checkVueSource` 声明后 typecheck 通过。
- 第二批（知识控制器）：`tests/knowledge-manager.test.ts` 等 6 文件 72 项通过（`--maxWorkers=1 --minWorkers=1`）；知识拆分前基线 6 文件 80 项为改前证据，不叠加为最终回归项数。Codex 用 TS AST 核对 `useKnowledgeManager()` 公开返回对象 126 项、顺序一致；typecheck、边界检查与变更文件 ESLint/Prettier 通过。
- 第三批（主进程装配）：运行时 17 文件 142 项通过；新增 factory 测试覆盖注册、惰性、限速与详情发布；typecheck、边界检查通过。
- 两处独立只读审查均未发现新的 P1/P2。

整合后补验：最新主线自定义模型 API 保留，登录/导航等 4 文件 31 项与 typecheck 通过；构建、变更文件 ESLint、边界检查通过，AST 核对主进程 22 项公开方法及顺序不变。原生桌面定向 15/15 通过，证据在 artifacts/desktop-selected-1794932859415/；知识库主专项 18 项、待学问题 2 项、内嵌学习进度 5 项通过，报告在 artifacts/knowledge-manager-check/evidence/，执行日志在 artifacts/maintenance-20261118/。

待学问题原生脚本首次因 loading 期间筛选区卸载而过早点击失败。同版本重跑及未拆控制器对照、模板与刷新逻辑核对定位为既存验收时序窗口；只增加目标筛选按钮已挂载且可交互的有界等待，原状态持久化、记录消失、跨店隔离和重新打开/忽略断言全部保留。修复后 DeepSeek 多次验证及 Codex 独立重跑通过；首次失败证据保存在 artifacts/maintenance-20261118/misses-first-failure/，不把初次失败记为通过。

最终回执：整理版本 1.0.56 随并行 README 更新进入 1.0.57，验收提交 beddc49。[CI 44128396327](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44128396327) 全绿，完成源码全量检查、完整桌面、知识学习、云端打包和打包程序检查。下载后的 release/ci-beddc49/ 清单版本/提交、安装器/便携 ZIP/清单三份 SHA256 均匹配；本机便携包验收 8 项通过（9119 个 ASAR 成员、8 个解析部分），详见 artifacts/packaged/report.json。首轮隐藏截图 UnknownVizError 后，同包原脚本复测通过，未改产品或图形参数；记录在 artifacts/maintenance-20261118/packaged-first-failure.txt 与 packaged-rerun.log。

主目录源码构建并打开，运行元数据与界面均为 1.0.57，原 userData 路径保留，临时调试端口关闭，回执见 artifacts/maintenance-20261118/source-runtime.json。其后另一个任务合入 1.0.58 开发调试功能，本条只证明 1.0.57 验收基线，不覆盖该任务的后续结果。未发布公开 Release、未部署生产。

## 2026-11-17：进店欢迎随机延迟与开关布局（1.0.52）

独立 worktree 内只使用临时数据、本机模拟店铺和合成文字；未打开真实店铺、未调用真实付费模型、未向买家发送消息，也未修改真实 userData。日常定向验证，不表述为全量通过。

- 定向 vitest（单 worker，12 文件/106 项）通过：欢迎延迟校验/抽样/等待/取消、真实厂商 claim/decorate 元数据与普通回复直通、批准拒绝、停店与人工接管取消、PDD 租约释放、异步最终复核竞态与发送前 guard 保持、店铺同步延迟字段与旧记录默认、Vue 标题开关/默认 1～3/冲突重新载入/Enter 非法范围。
- vendor `node --test tests/store-welcome.test.mjs`：7/7；`desk-v1/test/reply-engine.test.js` + `tests/managed-backend.test.mjs`：82/82；`tests/backend-integration.test.mjs`：7/7。未运行全量上游套件。
- `npm run typecheck`、`npm run lint`（含模块边界检查）、`npm run format:check`、`npm run check:vendor`（vendor 80、server 94）、`npm run build` 均退出 0。
- 原生仅运行 `LINGTU_DESKTOP_CHECKS=business:welcome-timing-settings`：1/1 通过，报告 `artifacts/desktop-selected-1794926409120/report.json`，截图 `artifacts/desktop/welcome-timing-settings.png`；复用 Wizard 接待设置，断言标题右侧启用开关、无冗余说明/普通载入按钮、默认 1～3、保存后同一记录、外部更新保留草稿并仅经“重新载入”替换、延迟 5～9 回读。临时 store 在 finally 删除。
- 限制：取消的同步状态检查每档≤100ms；网页消息异步复核沿用既有 hook 超时，不能声称包含异步读取在内的硬 100ms。延迟只作用于实际附加欢迎文字的首次 AI 正文，且欢迎认领已在装饰时消费，取消后不会自动重发欢迎。未运行完整桌面或上游套件，未打包发布、部署、提交或推送。

版本 package.json/package-lock.json=1.0.52。来源清单保留上游原始摘要并刷新 store-welcome/backend/reply-engine 与欢迎测试的实际 sha256；vendor 业务逻辑仍只做声明与元数据，抽样和等待在自有 TypeScript。

## 2026-11-17：文字 DeepSeek / 图片 Qwen3-VL（1.0.48，生产未部署）

隔离 SQLite、合成渠道、假 relay；不调用付费模型，不发送买家消息。固定上游提交 48a6c87f9e7757fdc58e5be9bcb4f8281ad0dfd0，复用已有库和账本。陈旧回环代理造成的 GitHub 连接问题通过仅本次进程移除代理变量解决，系统配置未改。

- RED：旧 JSON 被新默认污染、文字错误回退视觉、/me 错报文字默认的回归用例先失败；修正后定向通过。前端“视觉已配置但未授权”回归在旧判断下失败，恢复授权过滤后通过。
- 独立验收 3 项通过：文字/纯图/图文实际目标、文字/图片学习用途、重放无重复调用/扣次；98→99（文字）→100（图片），第101次两类均拒绝。已用唯一测试会话 ID 避免共享数据库碰撞。
- `go test ./lingtu ./lingtuhost -run 'TestTrial(Default|Saved|NoSaved)|TestLingtu(ModelPolicy|Vision|TextVisionAcceptance)' -count=1 -timeout=300s`：两个包退出0（0.701s/32.147s）。
- 完整 lingtu/lingtuhost 一次运行发现旧单模型/20次测试夹具假设（完整运行未通过）；仅修正相关夹具，不削弱授权/账本断言。所有失败项及独立验收重跑退出0（63.175s），日志 server/text-vision-compatibility.log。未重复无关全量测试。
- `bun run test src/features/lingtu/admin-page.test.tsx --maxWorkers=2`：28/28通过；授权状态修正另做单例红绿验证。
- `bun run typecheck`：1436文件/2项目通过；改动两文件 oxlint通过。
- `node --test server/tests/preparation.test.mjs`：翻译/生成2项通过。
- 原生网页以 http://127.0.0.1:3000 作为本机 API 构建通过；Windows amd64服务端编译通过，不将此本机页面包用于生产。
- 第一轮 GitHub MySQL：托管路由包通过，但新默认策略测试遗留加密 trial_policy 行，造成后续用例污染。仅在该测试夹具进入与退出时清理其拥有的策略行；本机默认/旧策略/身份定向重跑通过（1.360s），云端矩阵继续复跑。生产代码与数据库未变。
- 未运行完整桌面测试、完整 server:verify 或本机MySQL/PostgreSQL；GitHub CI与Linux构建结果另行记录，不冒充已经通过。

版本 package.json/package-lock.json=1.0.48。来源清单保留上游原始摘要并刷新实际哈希。生产未部署、未保存线上策略；仅升级不覆盖已有策略，新账号100次与指定双模型须在部署后明确保存。

## 2026-11-17：托管模型上下文策略（源码 1.0.44）

本轮在独立 Git 工作树用合成知识、隔离 SQLite 和本机模型夹具验证，不读取真实店铺资料、不调用付费模型或发送买家消息。管理员策略加密保存/CAS、客户端安全投影、桌面用途/版本/来源白名单、服务端学习准入与隐藏接待规则、知识引用预算均有针对性用例。接待知识预算 3 文件 46 项通过；固定桌面运行时 235 项通过；桌面 `typecheck`、生产构建与两份固定来源清单校验通过。服务端 `lingtuhost` 完整包一次 177.878 秒通过；合并后的策略/免费摘要专项通过；固定上游与自有计费重试、旧收据迁移专项通过。原生管理页策略编辑测试 7 项、翻译生成检查 2 项通过。

验证过程中先发现固定上游与本地自有测试同名，后发现新库无旧收据时计费迁移仍访问不存在的试用额度表；改名保留双侧测试，并仅在存在旧收据时执行回填。`server:verify` 原 180 秒的本机 Go 包期限因迁移夹具耗时接近上限，调整为与云端完整回归一致的 300 秒；未删除或跳过断言。随后新增的管理页提示使一次已准备的生成目录缺少新翻译，重新准备后翻译覆盖和该页测试均通过。最终 `npm run server:verify` 返回 0，`server/artifacts/verification.json` 为 passed，11 个步骤全部为 0：9 个目标 Go 包、完整 service 包、冻结依赖、翻译、路由、原生网页类型/lint、10 文件 62 项网页测试、网页构建及 Linux amd64 服务构建。

另把同一固定源码的网页构建为 `http://127.0.0.1:3001` 并构建 Windows 本机服务，在独立回环 SQLite 和随机管理员账户中实测原生管理页。登录后在“托管模型上下文”保存一条合成规则：运行时启用、检索预算 2048、单商品预配置 12，revision 由 0 增至 1；重新加载页面后提示词、预算与版本仍正确。页面明确显示学习接口不会写知识库、详情页采集未接入及次数限制未生效。已查看 `artifacts/managed-context-policy/admin-context-policy.png` 与 `admin-learning-policy.png`，布局和提示正常；现有 3000 端口服务及真实店铺配置未触碰。

桌面端启动前实际查看旧窗口：版本 v1.0.42、在线店铺 0，关闭后用同版本 Electron 运行本工作树构建；新窗口可访问性树确认页面从本工作树 `dist/index.html` 加载，版本显示 v1.0.44，在线店铺仍为 0。没有开启 AI 接待或修改店铺配置。

PR #34 首轮云端验证发现两处跨环境测试夹具问题：MySQL 共用测试库残留 `context_policy` 策略行及固定会话 ID，使新增策略测试发生 revision/主键冲突；已限定在自有测试中按策略键清理，并由测试名生成受长度约束的会话 ID。Windows 原生知识导入验收仍查找旧版“导入商品”菜单和旧选择栏；验收脚本改为当前“导入 → 导入资料文件”及卡片逐条勾选。修复后本机针对性 SQLite Go 两包通过，原生知识导入 7 项检查通过，桌面类型检查、lint、格式与固定来源清单校验通过。云端 MySQL/PostgreSQL 和 Windows 完整复跑仍以 PR 检查结果为准。

边界：`max_calls_per_product` 当前只保存和下发，没有可信商品身份可用于服务端限流；详情页自动采集、视频/语音解析及知识自动写入均未接通。检索预算使用 cl100k_base 估算完整引用，供应商实际 token 可能不同。未运行 MySQL/PostgreSQL、生产迁移、真实模型费用与买家发送验收；生产服务未部署。

## 2026-11-14：产品统一为灵兔 AI（本机改名）

产品、窗口/网页、模拟顾客页、登录宣传图、后台中英文名称、npm/安装包/云端产物和当前维护文档已改名，规则见 BRANDING.md。实际主目录与日常用户数据保持原位置；没有提交、推送、发布、部署或重启用户日常服务。官网与联系方式未配置时不继续冒用原产品地址或二维码，旧图片备份到 artifacts/branding-before-20261114。

本轮 npm run check 通过：16 文件 / 83 项单元（新增 2 项数据目录兼容用例）、229 项上游回归、类型/静态/格式、80 个客户端与 92 个服务端来源 SHA256，以及 Vue/Electron 构建。最后联系方式调整另跑单项测试 1/1、Vue 类型与改动范围 lint，并再次完整构建和桌面复验。最终桌面 78/78 通过，包含新标题/标识及宣传图加载断言；日志 artifacts/lingtu-brand-check.log、lingtu-brand-contact-test.log、lingtu-brand-desktop-complete.log。

本机内存和提交量偏紧，早期并行构建时桌面工具两次超过默认 180 秒；保留全部原有断言，改为顺序验证，并仅在本次工具子进程设置 LINGTU_DESKTOP_TIMEOUT_MS=600000 后通过。工具默认仍为 180 秒，新增有界参数不改变单项断言、业务/模型时限或生产程序。原生 F/E 跨盘字体引用也曾导致打包错误；最终使用既有物理工具缓存与正常原生入口完成，没有改字体解析或业务源码掩盖问题。

server:verify 实际完成固定上游准备、9 个目标 Go 包 SQLite 回归、2 项生成检查、1,428 文件/2 项目类型检查、聚焦 lint、7 文件/36 项原生前端测试及管理网页构建。Windows 串行回写产物较慢，在此阶段中止自动编排，改用 robocopy /MT:16 回写，原生返回码 1 表示成功复制；逐文件核对 1,846 个产物 SHA256 和成员完全一致，并单独完成相同 Linux amd64 go build 与许可复制。不能将该自动编排进程记为全程返回 0；本轮独立汇总在 server/artifacts/branding-verification.json，旧 verification.json 是历史执行结果。证据：artifacts/lingtu-brand-server-verify.log、lingtu-brand-native-copy.log、lingtu-brand-linux-build.log，以及 server/artifacts/branding-web-copy.json。

除 smoke 外，用正式 main.cjs 入口、全新显式 user-data-dir 实际启动，核对空店铺/无 Key 的真实业务快照、首次资料目录创建、网页名称和本地图片解码。artifacts/lingtu-ai-preview/{dashboard,login}.png 已查看，新名称和图像正常；报告在同目录 report.json。早期 smoke 截图可能在图片完成前捕获，本轮没有用覆盖基准来掩盖问题，另保留正式入口解码后的截图作为视觉证据。

没有生成新 Windows 安装包、替换已运行的 Windows 后端、使用真实模型 Key 或发买家消息；Linux 构建不等于 Windows 本机运行验收。历史安装包、来源名称、固定协议和内部兼容标识按原记录保留。

## 2026-11-14：主项目目录与云端配置收回（仅本机）

用户确认 F:\Setupgod\yunduo-ui 为唯一主项目，本轮只在此目录整理，其他文件夹保持原样，未初始化 Git、设置远程、提交、推送、合并或发布。代码目录、依赖、应用标识与运行数据没有迁移或改写；更新主入口、目录地图、约束、架构、运维、迁移和历史说明。

.github/workflows/yunduo-desktop.yml 已收回主工程，改为从独立仓库根运行，使用根 package-lock.json、根 release/artifacts 路径和动态 package 版本；移除旧分支、外层目录前缀、写入权限和自动 Release 发布。实际完成 YAML 解析、根路径/锁文件/只读权限检查、6 个 PowerShell 步骤静态语法检查与维护文档相对链接核对。当前未上传该配置或运行新云端任务，不将此前旧仓库构建结果冒充本轮独立根目录云端验收。

本轮实际 npm run check 通过：15 文件 / 81 项单元、229 项上游回归、类型/静态/格式、80 个固定客户端与 92 个服务端来源文件 SHA256，以及 Vue/Electron 构建。npm run test:desktop 最终 78/78 全部通过。证据为 artifacts/project-layout-check.log、project-layout-desktop.log 与 artifacts/desktop/report.json。未改界面或业务实现，未重建服务端、重打安装包、重启日常服务、调用真实模型或向买家发送。

目录与审阅入口为 PROJECT_LAYOUT.md、README.md、PACKAGING.md、.github/README.md；旧文件备份在 artifacts/project-layout-before-20261114，改动清单在 artifacts/project-layout-changes.json。下一步等待用户审阅，再确认版本管理和推送范围。

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

## 2026-11-16 多模型与人民币整合（1.0.18）

server:verify 已通过全部 10 个编排步骤（SQLite 的 9 个目标 Go 包、依赖锁、翻译、路由、类型、lint、8 文件 41 项前端测试、管理网页和 Linux 构建）。额外价格保存交互覆盖后 admin-page 22 项通过。无 MySQL/PostgreSQL 实例验收、供应商真实金额对账、生产迁移或部署声明。新增字段只做本机临时 SQLite 迁移验证。桌面 build 通过，1.0.18 源码已打开、版本及米配匠账号/AI关闭状态目视验收。

## 2026-11-17 同一买家随机回复节奏（1.0.49，局部验证）

- `tests/reply-pacing.test.ts`（10 项，exit 0）：首次迁移默认 1～3 秒随机并记录旧值、已保存模式不被覆盖、1～3600 整数秒与 min<=max 校验、CAS 必填与旧值拒绝、坏 JSON/反序/缺字段明确报错且原文件不变、首次迁移写失败报错、共享契约拒绝反序、按“店铺+买家+上次发送时间+策略指纹”每轮只抽一次且保存后当前等待立即重算、至少 1 秒。
- `tests/reply-pacing-factory.test.ts`（7 项，审查者新增，保留原文件，exit 0）：真实 `ReplyEngine → startStore → StoreWorker` 链路收到 resolver；不再有旧 60 秒与旧抖动；每买家独立抽样；保存后当前等待立即生效；未注入路径动态读取固定值并保留原抖动；审批仍必需；停止后旧批准不发送；单店分钟上限保留。
- `tests/message-diagnostics.test.ts`（6 项）与 `tests/simple-login.test.ts`（12 项）：等待原因读取本次已确定间隔；“未保存”草稿、快照刷新不丢草稿、CAS 冲突保留草稿并可重新载入。
- 其余直接相关：`tests/backend-contract.test.ts`、`tests/manual-reply-keywords.test.ts`、`tests/review-engine.test.ts` 通过；合计 7 文件 60 项（`--maxWorkers=1 --no-file-parallelism`，exit 0，无未处理错误）。
- 上游针对性套件 `desk-v1/test/reply-engine.test.js`、`tests/managed-backend.test.mjs`、`tests/backend-integration.test.mjs` 共 89 项通过（`--test-concurrency=1`，exit 0）。
- `npm run typecheck`、变更文件 ESLint（exit 0，仅 package\*.json 无匹配配置警告）、Prettier check、`npm run check:vendor`（vendor 80 / server 94 文件）、`npm run build` 均通过。
- 隔离桌面验收：`LINGTU_DESKTOP_CHECKS=business:reply-pacing-settings npm run test:desktop` 1/1 通过（exit 0）。用例先加载应用页面以启用 preload，再验证默认 1～3 秒、保存自定义 5～9 秒、旧固定值未被改写、反序与 3601 被拒绝、自定义输入按条件出现；截图 `artifacts/desktop/reply-pacing-settings.png` 已查看，1440 宽下无溢出。

未运行全量 `npm run check`、全量桌面检查、真实买家发送、安装包或发布；未改动店铺/账号/Key/AI 开关/发送审批。首次并行 Vitest 出现 Windows 临时目录 EBUSY，随后按要求用单 worker 重跑，全部通过。

整合复验（1.0.51）：保留主线 Apache 许可范围及知识库缺口反馈修改；8 个相关 Vitest 文件 90 项通过，含店铺向导 30 项（四选项、自定义、固定 1 秒、非法范围提交、冲突保留草稿）。非法范围回车提交已做红绿验证。合并后 typecheck、build 和隔离原生节奏检查 1/1 通过。
