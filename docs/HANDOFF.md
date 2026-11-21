## 2026-11-21 1.0.94 首页白色底栏、配置中心精简（源码，未打包发布）

按用户新要求，由 UI 设计师给出与现有蓝白界面一致的单一方案，本机 DeepSeek 在独立 worktree 实现，Codex 复核。首页底栏改为白底、细边框、蓝色额度和充值按钮；次要入口使用白色描边，发现更新以浅蓝强调，保留窄栏和低高度滚动。配置中心移除新额度/充值/客服/教程/更新/快捷回复卡片，仅保留原回复监控（含待确认数、忙碌和失败状态）与构建注入版本；删除不再使用的配置路由 footer 事件转发。账号、额度读取、更新通信、接待和知识数据机制未改。

相关界面测试、Vue 类型、定向 lint/格式/依赖边界及隔离源码构建通过；设计师复核真实 Vue 组件合成截图通过，含首页蓝白外壳、204px 窄栏、发现更新与配置中心精简状态。截图合成数据不代表真实余额；原生窗口复核和主目录启动结果待整合后补充。不重复运行未修改的更新器网络、真实支付/买家发送或全量 Release 测试。专项范围和证据见 [交接](parallel/SIDEBAR_LIGHT_20261121.md) 与 `artifacts/sidebar-light-20261121/`。

本批只递增一次至 1.0.94，不制作安装包、移动发布 tag 或部署服务端；公开版仍为 1.0.92，安装目录仍为 1.0.88。

## 2026-11-21 1.0.93 左下角额度与帮助入口（源码已打开，未打包发布）

用户要求参照截图重排左下角并核对旧版不提示更新。本机 DeepSeek 在独立 worktree 实现，Codex 复核后合入 `672a0ee`，package/lock 本批只递增一次至 1.0.93。主工作台与配置中心复用全宽深色额度卡、充值和客服/教程/更新按钮，显示实际版本与账号可用次数；保留快捷回复、回复监控及待确认数，不新增额度轮询。父层仍唯一持有登录/客服弹窗并隐藏内嵌平台页。

已用 REA 和定向 ASAR 阅读核对实际安装版 1.0.88 为 API-only；Codex 隔离 Electron 在默认网络真实收到 GitHub API 403/remaining=0，而当前检查器通过真实官方页面备用链发现公开 1.0.92。显式 7890 代理路径 API 200，两条路径分开记录，没有改全局代理。不能将本次证据冒充用户过去那次失败的运行日志；旧二进制需手动升级才能获得 1.0.89 起的备用链。更新器通信规则本批未改，修正的是新 footer 的状态展示、失败后重试和提示卡定位。

相关 31 项、最后文案修正后的 service 5 项、Vue/Electron 类型、定向 lint/格式/边界、隔离组件宽/窄/低高度与大额度截图通过。Codex 复核补齐满宽、更新失败不被缓存结果覆盖、路由监听仅挂配置页、提示关闭按钮/定位及聚合额度文案；主目录最终 `npm run build` 通过。无全量 Release 检查、安装包或公开发布。

通过既有中文源码启动器打开主目录，真实 MCP 与界面均为 1.0.93，原托管会话、两家店铺和知识摘要保留，无知识迁移。真实窗口已验证工作台/配置中心两处 footer、手动检查成功、充值跳转与额度一致、原充值订单可见、客服弹窗开关、教程打开官方项目页。充值页实际读到服务端 20000/300000 次及 98%/197% 增幅；没有点击套餐购买或订单操作。客服联系方式仍未配置，等待用户提供，不编造二维码。程序停留在源码工作台供用户查看。

公开版仍为 1.0.92，安装目录仍为 1.0.88；不要把当前已打开的源码 1.0.93 描述成已安装/公开的新版。证据在 `artifacts/sidebar-update-20261121/`，详细边界见 [专项交接](parallel/SIDEBAR_UPDATE_20261121.md)。下一步若用户要求安装包，再统一云端打包与发布验收。

## 2026-11-21 服务端新套餐与账号批量调整已上线

用户明确授权后，本机 DeepSeek 以实际生产学习后台的 SOURCE 为基底，只加入新套餐次数和账号批量试用调整；Codex 独立复核并验收。正式版本 `2026.11.21-quota.1`，计费协议 2，停机约 5.08 秒。标准包 ¥100 / 20000（两万）次，共创支持包 ¥1000 / 300000（三十万）次，体验包不变；新订单用新额度，旧订单和旧额度保留原条款。账号页支持多选、增加/扣减/设定试用总次数，原验证、冲突保护、审计和整批事务保留；没有代改真实额度。

定向 Go/SQLite、账号页 38 项、类型、lint、网页及 Linux 构建通过。服务器内断网副本与正式切换的全部受保护旧字段和 schema 一致，13 个账号、4 笔旧订单、2 条入账保留；受限配置、DNS/TLS 和其他站点未改。公网版本、鉴权、运行程序摘要和真实后台两账号三模式预览/取消/刷新通过。未进行真实付款/模型调用或三库矩阵；本机知识与桌面目录未接触，桌面公开版仍为 1.0.92。本次服务端独立版本与产物，不重发 Windows 包或移动 tag。

精确基底、来源补丁、摘要、首次隔离检查修正、备份与回退见 [部署验收](../server/DEPLOYMENT-20261121-QUOTA.md)。服务器备份保留 `/opt/lingtu-kefu/backups/20261121-quota.1`；回退仅换程序/网页，禁止恢复旧库覆盖新账。后续真实额度调整由用户选择目标及数值后明确提交。

## 2026-11-21 1.0.92 已正式公开发布

用户明确授权“可以打包发布”后，已推送主干并完成全量云端检查、同次产物下载、本机真实成品复验和公开发布。[v1.0.92 发布页](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.92) 已为 Latest；确切源码/tag 为 `2c518b109963b8cee08a05219b6f86dd00725061`，构建运行 `44773407325`，上传运行 `44776875593`。第一轮被一份交接文档格式阻塞，只修正文档并重跑，不改变产品代码或放宽检查。

完整源码检查219文件/1734测试、真实桌面97/97、知识管理18项、资料学习7项、云端及本机成品各10项通过。成品实际核对9120个归档成员、8个解析片段，临时资料目录中显示v1.0.92，未触碰真实账号数据。远程四附件digest与同次本机产物一致；匿名公开Latest入口和安装包下载HTTP200。安装器与ZIP、来源清单、校验文件均已公开，未覆盖旧版本。详见 [发布记录](RELEASE_V1.0.92.md)，证据与日志在 artifacts/release-1.0.92/。

本次没有运行安装器或替换日常安装，没有打开真实桌面、部署后台、修改线上套餐或真实余额。后台账号多选与新套餐额度仍需后续明确部署指令；Windows包内不含服务端。发布回执为同一批1.0.92元数据记录，不另升版本，不移动已发布tag。

## 2026-11-21 1.0.92 套餐增幅视觉强调（源码，未部署）

用户反馈增幅灰色小字不突出，并明确要求 UI 设计师介入。独立设计角色先给出静态桌面/390px稿，Codex检查并采用；本机 DeepSeek 在隔离 worktree 落地，官方会话 session-c463a860-ca21-4d09-a034-917c0524d312 退出码 0 且 final.reason.kind=completed。源码提交 93748b0 整合为主干 1718901；版本与锁统一递增一次为 1.0.92。

比较区移至价格正下方、调用额度详情上方，独立浅色块、88px最小高度、上下16px间距。基准说明“同等金额对比体验包”，主行以34px/800字重突出98%与197%；标准包蓝色、共创包乳金浅底深棕字，390px降至30px。体验包、缺少基准或无正增益时整区隐藏，不造零增幅或空白框。近似结果仍标“约多”；结构化展示与原单句格式共用同一计算，不反向解析中文、不改价或改额度。价格、有效期及上一批订单快照/提示绑定/支付行为均未变。

相关格式与组件测试46项通过，Vue类型、定向lint/格式通过。Codex检查实际代码和桌面组件截图，UI设计师再次检查宽屏与390px实现图并确认突出目标通过；本机合成组件预览量得增幅块高88px、间距16px、无裁剪或横向溢出。设计稿和实际实现图分开保留于 artifacts/billing-value-highlight-20261120/designer 与 preview，不把静态稿或mock transport表述为真实订单、支付或Electron主窗口验收。

主目录与已测维护源码一致，同码结果复用；1.0.92最终源码构建结果见 artifacts/billing-value-highlight-20261120/integration.json。未重跑未改Go/全量check/test:desktop，未打包、推送、部署或公开发布；尊重此前暂不打开软件的要求，未重启真实桌面，安装版仍为此前核对的1.0.88。线上套餐与账号批量额度功能仍待单独部署授权。

## 2026-11-20 1.0.91 套餐扩容、中文读数与单价比较（源码，未部署）

本机 DeepSeek 在独立 worktree 实现，官方会话 session-6eafb9c5-b20d-4417-9e74-1bfa35318c18 两轮均退出码 0 且 final.reason.kind=completed。Codex 独立检查差异、真实测试结果和隔离页面截图后，将 3a3dc5f、80b1048 整合为 a8d8132、8af841c。版本和锁本批统一递增一次至 1.0.91；不修改原账号、资料目录或既有额度，不打包、推送、部署或公开发布。继续保留此前用户暂不打开软件的状态，安装版仍为 1.0.88。

默认标准包 ¥100 调整为 20000（两万）次，共创支持包 ¥1000 调整为 300000（三十万）次，体验包 ¥9.90 / 1000（一千）次不变。稳定套餐 ID、价格、有效期/永久条款和自定义配置策略不变；已有订单按原快照恢复、支付和入账，不追溯补额度。套餐卡和收银台增加中文括注，套餐显示每千次费用 ¥9.90 / ¥5.00 / 约 ¥3.33；按实际体验包售价计算同等金额多 98% / 197% 额度，非精确值向下保留一位小数并标“约”。旧服务返回旧套餐时依实际数据展示，不伪造新额度或优惠。

复核修正了“二十万”误作“两十万”和将 137.6% 夸大为 138% 的边界；同 ID 旧订单条款不同会提示原额度，且提示绑定原订单 ID，换单后不残留。创建/恢复等待时可显示当前选择，但实际订单一旦返回，收银台立即以订单快照的价格和次数显示，避免目录变化后旧价格配新二维码；已有按订单快照与换渠道清提示的回归。支付服务、请求契约、验签和后台入账实现未改变。

最终相关组件/格式测试 42 项及未变的计费服务/重试测试 24 项通过，共 66 项；相关 Go Billing/Native 两包测试及旧单/新单/重复入账回归通过，Vue/Electron/工具类型、改动 lint/格式、边界和来源哈希检查通过。Codex 检查了 1440px 与 390px 合成页面截图，390px 无横向溢出；它们是本机 mock transport 组件预览，不是真实下单、支付或 Electron 主窗口验收。未运行全量 check、test:desktop、Release 或数据库矩阵。主目录同步源码后进行 1.0.91 最终构建，结果见 artifacts/billing-plan-value-20261120/integration.json；同码已通过的测试不重复全量运行。

详见 [专项交接](parallel/BILLING_PLAN_VALUE_20261120.md)。线上套餐和上一批账号多选尚未部署；如用户后续明确授权上线，按生产实际源码基线准备最小补丁，不顺带部署其他未上线功能，并保留现有订单与回滚。桌面安装包另需对应交付授权；此前 1.0.89 更新检查真实窗口验收仍暂缓。

## 2026-11-20 1.0.90 账号多选与批量试用额度（本机验收，未部署）

本机 DeepSeek 在独立 worktree 实现，官方会话 session-ff686dfb-5ccb-49d6-968a-63734635b592 两轮均退出码 0 且 final.reason.kind=completed。Codex 检查差异、事务与验证证据、实际截图后，将 3c40da9、02262ab 整合为主干 176c416、c970465。版本与锁同步递增一次为 1.0.90；本批仅修改后台，未构建或打开桌面，安装版仍为 1.0.88，先前 1.0.89 的真实桌面更新检查验收仍按用户要求暂缓。

账号表支持逐行多选、当前页全选和批量增加、扣减、设定试用总次数，提交前逐账号预览。沿用管理员验证与完整请求绑定；事务内重读资格、核对旧总额、保护已用及处理中次数并写审计，任一非法或冲突整批回滚。有效期、模型、账号状态、会话、付费及永久额度保持原行为。复核补齐提交/验证期间切页和刷新锁定，取消验证或冲突后保留选择与输入；窄屏预览表在内部滚动。详见 [专项交接](parallel/ADMIN_ACCOUNT_QUOTA_BATCH_20261120.md)。

38 项账号页测试、相关 Go 管理/额度/并发回归、原生网页类型与定向 lint/翻译/来源检查通过。Codex 独立检查真实本机合成账号页面的 1006×1000 与 390×844 截图；未修改真实账号。最终网页使用生产 API 来源构建，Linux amd64 构建通过；候选程序 SHA256 为 88781d67cdb15d4dbaae9e92b564e91966e68347a1fa26bd548efc9270db793c。未运行三库矩阵、全量上游或 Release 验证，不把本机 SQLite 结果称为生产验收。合入后核对维护源码与已测 worktree 一致，复用相同代码的已通过结果，不重复全量测试。

证据在 artifacts/admin-account-quota-20261120/。生产服务、数据库、真实账号额度均未更改；未推送、打包或公开发布。下一步如用户明确授权部署，须先按生产实际源码基线核对最小补丁，避免顺带部署其他尚未上线的主干功能，保留回滚并在真实后台验收入口及只读状态；真实额度调整仍由用户选择账号与数值后明确提交。

## 2026-11-20 1.0.89 更新检查限流修复（源码，未发布）

本机 DeepSeek 在隔离 worktree 实现，官方 headless 两轮退出码 0 且 final.reason.kind=completed；Codex 复核后合入 3bec42d、2e2e8b6。真实匿名 GitHub API 曾返回 403/remaining=0，原检查只依赖该 API。现在仅在 403 且 remaining=0 或 429 时读取固定官方发布页：不跟随跳转，校验本仓库 v<三段版本> Location，再校验对应 expanded_assets 的精确安装包。API 正常、错误/草稿/预发布/缺包拒绝、启动缓存、手动重试与并发合并保持原样，API 与备用链合用 15 秒总预算，UTF-8 响应上限 256 KiB，页面请求显式 omit 凭据且使用无持久化 session。不下载或执行安装器，不改代理、账号、AI 或知识数据。

相关四文件 33/33 通过（19 检查器、8 原生适配器、3 UI、3 IPC）；有针对限流、凭据默认值和中文超限的 RED/GREEN 证据。Vue/Electron 类型、改动 lint/格式、依赖边界通过，主目录 npm run build 成功，版本与锁递增一次为 1.0.89。原生隔离 Electron 验证了真实 API 200 路径和注入 API 403 + 真实官方发布页备用链；API 在测试期间恢复额度，未故意耗尽配额。结果可区分较旧版本 available 与当前较新版本 current，不提示降级。未将注入限流表述为全程真实限流。完整记录见 [专项交接](parallel/UPDATE_CHECK_FIX_20261120.md)。

切换前读回 Root User、两家拼多多在线/AI 保持原开启意愿、米配匠 6 商品/89 待审核/6 任务；闲鱼店铺已由用户在此前使用过程中移除，不恢复旧登记。已正常退出本机 1.0.88 安装版（原 PID 21216），未强杀其他软件。自动通过既有源码启动器打开 1.0.89 的操作被工具自动审批拒绝，仅返回 blocked by policy；没有改用其他自动启动入口绕过。当前源码已编译，待用户手动双击主项目“启动源码（不构建）.bat”后完成真实主窗口检查更新与数据复核。安装版仍为 1.0.88，不把源码修复冒充安装版已经更新。本批未打包、未创建 tag/Release、未部署服务端。证据在 artifacts/update-check-fix-20261120/。

## 2026-11-20 1.0.88 本机安装（未公开发布）

按用户“打包新版本安装好，但是不发布”授权，将版本与锁统一递增为 1.0.88。云端最终构建为 [44573131084](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44573131084)，确切源码 759b8bd36aaf1918ef27ca0cc20b5d926710a5e7。全量 check（217 文件/1682 项）、真实桌面 97/97、知识库管理 18 项、资料学习 7 项及真实成品检查通过；成品检查实际核对 9120 个归档成员和 8 个解析片段，保留许可、私有文件排除和开发能力隔离。

前三次构建分别被过时的引导/模拟入口夹具、旧商品编辑入口和旧页脚按钮数阻塞。本机 DeepSeek 在隔离 worktree 复现并仅修正验收文件，Codex 独立复核后合入；没有修改产品实现、vendor、发送/身份/审核保护。过程与 RED/GREEN 记录见 [专项记录](parallel/PACKAGE_1088_VALIDATION.md)。

同次 Actions 安装包、ZIP 和清单下载到 release/private-1.0.88-run-44573131084/，SHA256 全部一致。安装器退出码 0；现有 Program Files 安装目录的 EXE/ASAR 与下载 ZIP 内逐字节哈希一致，Windows 安装记录和 EXE 版本均为 1.0.88。安装包 SHA256：AB7372E8B6472E3F49330C362C14C5F11BE91A0D926F1475E4E759D2CF10CBCB。

原资料目录 C:/Users/90760/AppData/Roaming/yunduo-ui-restored 保留；安装前已备份到 E:/codex-builds/lingtu-1.0.88-install/profile-backup，业务目录 1282 文件安装前后哈希完全相同，3 店铺与知识库 13 张表的基线已记录。未清空、迁移或重试旧学习任务。未创建 v1.0.88 Release（含草稿），公开版仍为 v1.0.74，未部署服务端。

自动打开已安装程序曾被工具自动审批拒绝，仅返回 blocked by policy，未绕过。用户随后明确回复“已打开”；只读复核确认实际主进程 21216 位于原 Program Files 安装目录，原 yunduo-ui-restored 资料路径与 app.asar 生效。真实窗口 199170 和 MCP 均为 1.0.88，Root User 托管会话已恢复；两家拼多多在线并恢复原 AI 开启意愿，闲鱼保持未登录且 AI 关闭。三家店铺 ID/名称/平台与安装前一致，知识库 13 张表的记录数完全一致；米配匠 6 商品、89 待审核知识、6 学习任务均可读。未触发登录、导入、学习、发布、AI 开关或买家发送。本机安装及运行复核完成，窗口保持打开。更新检查当前显示“检查失败，点击重试”，与本次成功启动分开记录，未改代理或更新设置。证据在 artifacts/install-1.0.88/runtime-acceptance.json 与 data-after-launch.json。

## 2026-11-19 1.0.87 源码编译与重启回执

用户随后明确授权“编译一下源码，重启打开最新版给我看看，不用打包”。在已整合 b03ea54 上运行 npm run build，前端、main 和 preload 均编译成功；版本保持 1.0.87，不再次递增。旧进程 153816 正常退出，经既有中文源码入口对应脚本启动新实例：主进程 63912、启动控制台 156372、窗口 80748876。界面左下及 MCP 均确认实际运行 1.0.87，Root User 托管会话和三家已登记店铺保留。

原业务目录未改：米配匠 6 商品/89 待审核知识读回，两家识图开关版本与开启值一致。两家拼多多在线；原保存的 AI 开启意愿经现有身份核验恢复，未手动修改开关。闲鱼保持未登录，未代登录、导入、学习或发送。主进程/preload 的新引导代码已编译并随新实例加载，但实际新店八步原生布局和真实扫码回填仍需单独操作验收，不以本次启动冒充全流程通过。

初始窗口未前置，使用现有 second-instance 激活后完成界面检查；没有添加启动补丁。更新检查的网络失败日志保留，与本次源码启动成功分别记录。构建与截图/结果见 artifacts/source-1.0.87-acceptance/，运行日志见 artifacts/source-live/20261119-234009-551/。只提交此回执，没有制作安装包、发布或部署。

## 2026-11-19 添加店铺简化与八步引导（1.0.87 源码整合，未构建）

按用户在功能聊天批准的计划，将前序添加店铺简化 7eb95fb 和八步引导 2e6bd2a 精确挑入 1.0.86 主线；未合并该功能聊天的其他历史分支。版本与锁统一递增为 1.0.87，训练场多轮修复代码及回归原样保留。

整合目录中的相关 10 个测试文件共 112 项通过，覆盖新店登录确认/文件及采集学习租约/未知提交闭锁、既有基础设置与复用、添加入口、主侧栏、固定原生布局及训练场多轮克隆。Vue/Electron 无输出类型检查、依赖边界、vendor 来源及哈希检查通过；复用执行者对同一 vendor 内容的 242 项上游结果。没有运行 build、build:desktop、打包、部署或推送，没有主动重启桌面。

源码版本为 1.0.87；当前主进程仍为之前已启动的 1.0.86，旧 preload 缺 onboardingPresentation 标记，继续保留原新店流程。不得称八步原生布局已在当前桌面生效。下一项是用户允许源码编译后，验收主进程/preload、固定 216/72 顶边及真实登录身份回填；真实导入/学习仍需用户确认范围和额度。记录见 [整合验收](parallel/ONBOARDING_INTEGRATION_20261119.md) 及 [功能交接](parallel/NEW_STORE_ONBOARDING_20261119.md)。

## 2026-11-19 训练场多轮 IPC 克隆修复（1.0.86 源码）

本机 DeepSeek 在独立 worktree、基线 c0a339d 上实现，执行退出码 0，官方 NDJSON final.reason.kind=completed；Codex 独立复核后整合。训练场历史原为 Vue 深层响应式对象，slice 只复制数组，第二轮起 IPC 克隆失败。现在只在本组件提交边界映射出普通 from/content 对象，保留历史、最近 20 条上限、图片参数、商品/店铺绑定和迟到结果守卫；未改全局序列化或 vendor。

回归先在旧源码出现第二轮 DataCloneError，修复后相关 13 项测试、Vue 类型、改动文件 ESLint/Prettier 和源码构建通过。Codex 在临时数据目录的真实 Electron 主窗口连续提交三轮，验证第二轮携带首轮问答、第三轮携带前两轮问答，真实 preload/IPC/本机模型传输均通过。模型为本机回环夹具，不把该验收表述为 DeepSeek 真实模型或买家发送验收。初次验收脚本使用旧标题栏选择器失败，修正为当前窗口控件选择器后通过，失败日志保留。

用户确认已保存当前店铺设置并允许重启；本批递增一次为 1.0.86，同步锁版本。原账号、业务目录及三家已登记店铺保留；启动与最终验收回执见 [专项记录](parallel/TRAINING_CLONE_FIX_20261119.md)。未制作安装包、未推送或公开发布、未重试旧知识库任务。另一个聊天的添加店铺简化候选不在本次修复范围。证据位于 artifacts/training-clone-fix-20261119/。

## 2026-11-19 后台宽屏布局（1.0.85 源码）

后台 admin-workspace 移除 1600px 上限，工作区随可用宽度伸展。浏览器局部样式预览在 2560px 屏幕下宽约 2326px，390px 窄屏保持无横向溢出；原样式的小屏断点及卡片布局沿用。已检查实际截图，原生后台网页 Bun 1.4.4 / Rsbuild 构建成功。预览截图位于 artifacts/deepseek-unified/admin-wide-preview.png 与 admin-narrow-preview.png。用户明确确认后，已上线到现有账号后台。保留原 JS 与 Go 程序，以独立内容哈希 CSS 和原子替换 HTML 引用部署等价规则；备份在 /opt/lingtu-kefu/backups/20261119-admin-wide。刷新真实页面后临时预览样式不存在，线上样式已加载，实际内容宽 2314px，等于 main 宽度，横向溢出为零。HTML/CSS 均 200，原服务程序 SHA256 已核对一致。部署与实机截图见 artifacts/admin-wide-20261119/，1.0.85 桌面源码已打开，原账号和两店恢复。

同次复核线上托管策略已保存，model_scope=selected、allowed_models 只勾选 deepseek-flash、default_model 和 vision_model 均为 deepseek-flash。现有 DeepSeek 连接的固定合成图片验证通过；后台保存成功及已保存选择已从管理界面核对。该事实属于用户明确授权的线上模型配置操作，没有部署永久额度候选，也没有重试学习任务。

## 2026-11-19：共创支持包永久额度（1.0.84 源码）

千元共创支持包的新订单为 100000 次永久额度，另两档保留 365 天。旧订单按原快照结算，过期额度不回补。永久额度独立入账、预占与结算，试用延期保持为有限期限。客户端从服务端标识显示永久期限及余额，兼容旧服务的 365 天返回。

55 项客户端相关测试、Go 计费及额度回归、Vue/Electron 类型和源码构建通过。隔离桌面 2 项通过，含真实充值页永久套餐及普通 365 天的视觉文本。1.0.84 已用原业务目录启动，原账号和两店保留。生产后台未部署本候选，也未创建真实订单或付款。上线前需另行授权并验证数据库迁移、回滚和旧订单；参见 server/BILLING_DEPLOYMENT.md。局部验证证据见 artifacts/permanent-support-1.0.84/。

## 2026-11-19：精简登录与充值入口（1.0.83 源码）

图片识别模型设置只在本地 Key 模式显示。托管登录弹窗移除“我的订单”“算力消耗”“切换账号”“刷新额度”，保留充值、当前额度和退出登录。充值页默认展示最近订单与额度，继续复用启动会话同步、页面读取和到账后的账本刷新；充值页统一刷新保留，供读取失败时重试。

53 项相关测试、Vue/Electron 类型、改动文件 ESLint 和源码构建通过。隔离桌面本地 Key 与充值入口两项、托管会话与登录/充值界面两项通过，首轮失败为额度标签断言文字不匹配，修正后复验通过。原数据目录已重启到 1.0.83，原账号和两店已连接，实机只读确认简化弹窗、充值页额度及订单表。未创建支付订单或付款。本轮为本地源码交付。证据见 `artifacts/account-recharge-1.0.83/`。

## 2026-11-19：知识库列表与商品资料编辑（1.0.82 源码）

本机 DeepSeek 在独立工作树实现，续修提交 `6664ba1`。Codex 核对本店资料、绑定版本、价格过期、附件回滚和窗口生命周期后，验收提交 `370e9a7` 已快进合入本地 main。列表重排并保留学习、审核和批量操作。新弹窗支持本地加图、标题、手工价格、备注、文案和原问答入口。保存使用本店专用版本化来源和附件，兼容既有商品及备份；共享标题、商品绑定版本和已审核问答保持原值。

相关 9 个测试文件共 132 项通过，覆盖并发冲突、附件回滚、旧资料、店铺隔离、学习及备份恢复。Vue 和 Electron 类型检查、改动文件静态检查、依赖边界、Vite/Electron 源码构建通过。Codex 用临时业务目录的真实 Electron 主窗口验证了从商品行打开编辑、两张图取消、另存后重开、同款同编号切店、冲突保留输入、桌面 980px 弹窗和窄屏固定底栏。验收资料位于 `artifacts/knowledge-product-editor-20261119/`。

原数据目录启动 1.0.82，主窗口左下和 MCP 版本一致。原 Root User 账户和两家店铺在线，米配匠 6 件、店口五金店 0 件的知识库分页均可读取。实店只读核对，保存和冲突测试均在隔离店铺。两份既有 AGENTS 修改原样保留。本轮交付为本地源码，未推送、打包或公开发布。可从配置中心的店铺商品入口打开新版；正式安装包由后续发布批次验证。

## 2026-11-19：完成设置后继续知识库配置（1.0.81）

店铺信息助手的完成页在“完成并返回”右侧新增“继续知识库配置”，复用公开知识库服务打开向导所属店铺的商品页；保留已保存配置和返回向导状态，不执行采集、学习、发布或 AI 开关操作。底部按钮支持窄屏换行，源码与锁版本统一 1.0.81。

相关 8 项组件/状态测试、Vue/Electron 类型、改动文件 ESLint/格式检查和源码构建通过；隔离 Electron `business:shop-setup-reuse` 1/1，验证三按钮顺序、目标店铺/products 上下文、知识库页面可达、已保存欢迎配置与 AI 状态不变。该隔离场景保留独立知识库窗口适配，未将其冒充生产内嵌窗口验收；完成页按钮和目标页截图已查看。初次桌面断言误将适配窗口当主窗口而失败，已按实际上下文/目标页修正；更新查询网络失败及退出回调缺 handler 日志保留，不属于此次按钮修改的解决范围。

主目录已正常重启并打开源码 1.0.81，真实界面及 MCP 版本一致，原账号、两家店铺登录和用户原有 AI 开关已恢复；没有为验收保存真实店铺设置、调用模型或发布知识。原两份 AGENTS 未提交修改保留。证据为 `artifacts/desktop-selected-1795089303115/report.json`、`artifacts/desktop/shop-setup-reuse.png`、`artifacts/desktop/shop-setup-continue-knowledge.png`。本轮未打包/发布/升级后台；后续可在完成页直接进入当前店铺知识库。

## 2026-11-19：1.0.80 托管后台升级与单商品真实验收

用户明确授权后，生产后台已切换至 `2026.11.19-learning.1`，管理员经原生身份复核保存学习启用和单品上限 40（策略版本 2）；视觉、4096 输出上限和人工审核保留，接待运行时规则未开启。原配置/密钥/数据库均已备份，正常停服后最终备份完整性通过，切换后原账号与账务记录保持。部署时补齐了 Nginx 使用的同版静态网页，外部管理入口恢复并与候选资源校验一致；没有修改其他服务、域名、代理或安全设置。

主目录源码 1.0.80 已用原 userData 正常重启，界面和 MCP 均确认版本；原账号、两家店铺和原知识保留，两店 AI 关闭。旧故障原请求经核对后仅通过正常界面解除暂停；旧 111/17 步任务正文哈希未变，未重试/跳过/取消。对已采集最小商品之一“小米汽车中控屏配件螺丝”新建单独估算，确认 8 次后实际执行 8/8 成功；服务端新增恰好 8 个学习请求，生成 7 条未发布草稿，来源、商品/SKU、店铺和图片分块位置已核对，没有额外模型探测或买家发送。

本轮验收仅证明一个真实商品的文字/图片学习链路恢复，未执行全量回归或安装包/公开发布。草稿中有 1 条“文本暂无预览”和 3 条过期 SKU/库存候选，均保留待人工审核，不能视作已可用于回复的知识；旧 111 步任务仍会显示待确认，不能据此重放。软件停留在“待审核 7”页面。下一项是人工筛选/核对草稿，旧批量任务须另行明确决定；验收细节见 [实测回执](parallel/MANAGED_LEARNING_LIVE_ACCEPTANCE_20261119.md)。下方为升级前阶段记录。

## 2026-11-19：托管商品学习兼容修复（1.0.80，升级前候选阶段）

本机 DeepSeek 在隔离分支完成 `34cb508` 与续修 `d4b10bf`，Codex 独立审查发现并关闭真实装配漏转发、旧本机计划兼容、商品调用预算、暂停/队列提交时序、估算并发消费、来源变化六项问题后合入主干。相关 11 文件 128 项、类型/静态检查通过；真实装配测试经过 runtime/adapter/vendor mock transport 验证学习用途/策略/来源发出，旧服务端零 chat 请求，普通回复与人工 uncertain 门保留。1.0.80 客户端源码构建已成功，未打包/发布；没有为本次修复重启当前原账号的在线窗口。

只读生产账本确认本次学习首请求为 `invalid_model_reply`；当前线上仍 `2026.11.19-support.1`，尚无学习协议。另有两件商品分别需 25/37 次调用，故候选将单品预算的可配置上界扩至 40，默认仍 20、学习默认关闭；配置须管理员显式保存，任务仍先估算/确认，不静默丢资料。新增边界 6 项及管理端 8 项通过，相关 Go 策略/协议/视觉兼容回归通过。服务端候选标识 `2026.11.19-learning.1`，原生管理页和 Linux amd64 产物已在本机准备；主目录深路径原生 Vitest 的环境失败未计为通过，使用既有物理校验缓存和冻结锁后验证成功。

**仍未完成：**生产服务升级、学习策略开启/提高上限、当前桌面切换及真实样例学习验收。均未自动执行；旧学习任务、暂停记录、账号、余额、知识和两份无关 AGENTS 修改保留。下一步须用户明确授权部署/启用策略后，再按新协议核对现状及单次受控样例，旧 111 步任务不得自动重放。范围、证据及部署前置见 [修复回执](parallel/MANAGED_LEARNING_FIX_20261119.md) 与 [候选部署说明](../server/BILLING_DEPLOYMENT.md)。

## 2026-11-19：手动启动源码、不构建（1.0.79）

用户随后要求“先构建一版新的”：已在主目录对源码 `af95d5b` 执行 `npm run build`，Vite 和 Electron 构建 exit 0；前端及 MCP/CLI 版本 1.0.79、产物非空与主进程/preload 语法检查通过。主进程通过 app.getVersion 读取 package.json；重建 main/preload 与原文件哈希相同，前端产物已更新。仅更新源码运行产物，未打包、发布或打开软件，账号和知识资料未操作；证据在 `artifacts/source-build-1.0.79-20261119/`。以下“复用原产物”为本入口最初交付时状态。

新增根目录 `启动源码（不构建）.bat`，复用原启动脚本的 `-NoBuild` 分支与控制台进程树保护。只启动本目录 Vite 和既有 Electron 产物，不安装依赖、不构建、不打包；不传新 userData、不修改账号或知识数据。输出写入 `artifacts/source-live/` 文件，已有实例、缺失产物或 5173 端口占用时直接报错；退出/失败清理仅本次启动的进程，原构建入口保持原行为。

Windows PowerShell 5.1 语法检查和五个纯模拟生命周期场景通过；未真实运行新增入口、未自动打开软件，也不把模拟通过表述为桌面验收。源码与锁文件统一 1.0.79；主进程仍复用原产物，其新源码修改不会因此生效。由用户手动双击后再核对真实启动、日志及退出；托管模型/学习协议问题不在本次修改范围。详见 [入口回执](parallel/SOURCE_LAUNCHER_20261119.md)。

## 2026-11-19：知识库批量学习整理合入（1.0.78 源码）

本机 DeepSeek 在独立 worktree 整理原有八文件未提交草稿，保留原稿 checkpoint `8c75b86`，实现及修正提交 `334d558` 已合入 main，并保留远端 `c9147f4` 的 README 更新。批量学习只估算当前店铺、当前筛选内的精确选中商品；分页与选中集合变化会丢弃迟到结果，来源去重并排除已移除、未选商品及外店来源。复选框保留，选中后才显示操作栏；单件学习及现有明确确认门保留。

Codex 已检查实际差异、RED/GREEN 和静态证据，一次独立只读审查未发现阻塞问题。相关两文件 59/59 测试、changed ESLint/Prettier、依赖边界、Vue 与 Electron noEmit 类型检查通过；合入后核对实现文件与已验收提交一致。源码版本与锁文件统一 1.0.78。按本次用户要求未构建、打包、启动或重启软件，未做原生界面、真实模型或实店验收；运行中的旧实例版本不作本次交付声明。原始草稿备份和两份无关 AGENTS 未提交修改保留。完整范围与后续原生验收条件见 [回执](parallel/KNOWLEDGE_BATCH_LEARNING_20261119.md)；公开版仍为 v1.0.74，后续构建、界面验收与发布按新指令执行。

## 2026-11-19：用户确认后切换 1.0.77 Vite 桌面

用户已选择“现在重启桌面”。原实例正常退出，现已运行 PID `120660` 的 1.0.77 源码桌面，页面实际来自主目录 Vite 的 `http://127.0.0.1:5173/#/shop/manage`，配置菜单完整显示，原账号及两家店铺资料保留。复用既有 Electron 主进程产物，仅运行不含构建的开发启动步骤；没有 build、打包、知识任务确认/重试或买家发送。其他批量学习未提交代码仍未验收，见 [切换回执](parallel/CONFIG_NAVIGATION_20261119.md)。下方“桌面待切换”记录为此前阶段状态。

## 2026-11-19：拼多多与闲鱼公开状态说明

合入 `665a339`，中英文 README、PLATFORM_STATUS、当前约束及 v1.0.74 文档已按维护者实店确认标为两平台已开放、支持正常使用，保留闲鱼具体能力限制及历史自动化范围。公开 GitHub 中英文正文已读取核对；既有 v1.0.74 发布页追加同一状态段，验证原正文前缀、tag、发布时间及四个附件 ID/大小/摘要不变。没有新构建、安装包、tag、Release 或部署，没有改运行时平台校验、发送确认门，也没有重启当前桌面。状态来源与边界见 [平台说明](PLATFORM_STATUS.md)。

## 2026-11-19：配置侧栏菜单（1.0.77 源码与只读预览）

合入 `5d228c8` 的局部 Grid 行布局，菜单独占剩余高度，底部入口按内容占高。主目录 Vite 实时加载 v1.0.77，独立复核 1440×920 与 1280×720 的菜单高度、短窗滚动及质检/店铺切换通过；未运行任何 build 或打包。当前原桌面仍为 1.0.76，保留两家在线店铺和知识库学习待人工确认现场；源码修复不能冒充已经应用到旧 dist。切换桌面仍等待用户选择，见 [回执与预览地址](parallel/CONFIG_NAVIGATION_20261119.md)。其他知识库批量学习未提交改动保持原样，不属于本次提交。

## 2026-11-19：知识库内嵌主内容区（1.0.76 源码交付）

合入 `ee90f83`，保留 1.0.75 的更新入口、完整标题和配置侧栏修正。原“查看商品”入口在主窗口 `#/knowledge` 内容区打开知识库，保留店铺/训练商品上下文、离开保存及原生关闭确认；不再创建正式知识库子窗口。主目录相关 10 文件 87 项、源码 build 通过；原账号两店保留，米配匠 6 件商品→店口五金店独立资料→返回并重开米配匠 6 件商品已本机查看，始终一个项目窗口，实际运行 1.0.76 并保持知识库打开。见 [交接回执](parallel/KNOWLEDGE_EMBEDDED_20261119.md)。

本轮未打包/发布/部署，公开版仍为 v1.0.74。启动时工具控制台管道断开的 EPIPE 已通过持久日志启动排除；旧版本关闭后后台残留与本次官方更新查询失败单独如实记录在回执，未扩大为已修复项。后续打包及正式发布仍等用户明确指令。

## 2026-11-19：更新入口与完整标题（1.0.75 源码交付）

合入 `5f07dbf` 和侧栏修正 `191e208`，恢复工作台/配置中心左下检查更新；启动查询一次固定官方正式 Release，可手动重试，新版显示可关闭提示，用户点击后打开下载页。完整标题不再被导航覆盖。主目录相关 6 文件 25 项和源码 build 通过；实际运行 1.0.75，原账号与两家店铺保留，双入口/完整侧栏/常规宽度标题已本机查看，见 [交接回执](parallel/UPDATE_PROMPT_20261119.md)。

本批不打包、不发布，公开版仍为 v1.0.74。知识库内嵌正在独立分支继续开发，尚未作为本次完成项合入。后续打包按新指令处理，正式发布必须再次取得用户明确确认。

## 2026-11-19：1.0.74 已合入主干并发布

尺码、视觉、充值及其他分支的已提交改动全部合入 main。完整源码检查、96/96 桌面验收、知识库流程、云端 NSIS/ZIP、同次产物下载后的本机打包版启动与解析检查通过；v1.0.74 已公开发布，来源为 `81e9e9b7d261b8708067f92cc649481592d45706`。完整证据、产物校验、保留边界与后续条件见 [发布回执](RELEASE_V1.0.74.md)。

清理 37 个已合并本地分支、16 个远端分支；3 个含未提交改动的分支、34 个修改文件、3 个 stash 和所有 worktree 目录均保留。正式源码 1.0.74 已打开，原账号和两家店铺资料保持；本次没有真实付款、买家发送或新托管视觉服务部署。以下记录为整合前的阶段历史，以本段发布回执为当前状态。

## 2026-11-19：尺码/视觉公共整合与最终发布修复（1.0.74，整合前历史）

隔离分支 `codex/size-vision-integration-20261119` 已合入 main `9ab671a`、本机视觉 `9e4809f`、managed vision `8a56466`、billing support `786dbb0`，并同步最新 main `3ce4f84`（仅 README/`start-source.ps1`/`一键启动源码.bat`）。server `source-files.json` 合并后 107 项，billing 与视觉两方路径无缺失，当前所有 SHA256 与 server 实际文件一致；billing 代码未重跑未变 Go/React 测试，仅复用其 31 项客户端与两包 Go 验收回执。保留 1.0.70 MCP、1.0.71 训练迁移、1.0.72 欢迎自动保存、1.0.73 配置中心嵌入。

- P2 终态尺码修复：使用生成时确定性回复作为 canonical，对 eligible 标签加仅内存占位后调用真实 vendor `filterBannedWords`，还原标签并按同店最终文本做“完全相等或长度前缀”校验。任意标签替换（M→L/2XL/3XL/加大码/大号/自定义标签）均拒绝；普通非标签禁词删除和店铺长度截断允许；不重写实际 final text、不重插禁词、不引入占位到真实消息。
- 正式 `beforeSend` 与兼容 `start-training` 两链都使用同一 canonical 校验。`installSizeReplyGuard` 在 `enforceSizeReply` 之后以 guarded 结果自身的真实 traceId 回调 candidate guard；不再读取 vendor 早于 guard 的 raw result 事件。training 的 canonical 在同一 AsyncLocalStorage owner 内取出。valid selection 有证据但 canonical 缺失时直接闭锁，不再使用旧正则兜底；known `evidence=null` 与无 trace 欢迎/非模型路径保持普通。知识库主 trial 仍在原预算/租约链注入证据并复核版本。
- 正式 proposal 若含厂商欢迎装饰，使用当前 `welcomeByStore` 且版本与 `proposal.welcome.version` 一致的可信 greeting（同一 vendor 禁词过滤）仅剥离精确的 `greeting + 换行` 前缀；任意第一行/任意前缀不剥离，不修改待批准正文。
- 候选证据为每个 reply trace 的 `evidence|null` 有界 Map（1000）；unknown/淘汰 trace 闭锁，明确 null 正常；训练/试问 trace 不占正式回复候选。
- 本机视觉公共 assembly、五命令、六字段快照、LoginDialog 挂载、损坏文件只闭锁图片、managed 最早分支旁路已完成；买家含图回复原路径不变。
- 移除“客服工单/工单登记”菜单与独立本机/团队登记页；保留后台工单数据/API、辅助中心历史/状态/跟进、平台工单和数据看板卡。旧 `?panel=workorder` 回落店铺列表。
- 尺码 CSV 导出复用 `shared/platform/files.downloadText`，保留 owner/卸载迟到检查；ShopKb 与结构化区域说明改为简短用户操作提示。
- Vitest 配置统一 `maxWorkers=2/minWorkers=1`，保留原断言和 5 秒单项超时；`knowledge-model-learning.test.ts` 25 项一次通过（10.8 秒），解决 GitHub 全量并行争用导致的两个 5 秒超时。

验证：本轮正式接线回归 4 文件 34 项通过；此前相关回归 9 文件 63 项（尺码 32、billing 31）与图片学习 25 项保留。真实 `AiClient.reply + 尺码 guard + ReviewConsole + candidate + vendor filter` 探针 GREEN：raw XL→guarded M，正式 2XL 拒绝，干净 M/删词/截断通过，欢迎前缀正确 M 通过且 2XL 拒绝，expired/unknown canonical 闭锁、known null 正常。P2 标签替换探针 7/7 拒绝。完整 `npm run typecheck`、`npm run lint`（含 boundaries）、changed Prettier、`npm run build` 退出 0。真实隔离 Electron `business:size-vision-common` 1/1（复用代码未受影响的上一轮证据）：renderer 结构化尺码编辑/绑定/保存、精确“预览表格”真实预览 2 行、knowledge trial 与 start-training 拒绝 XL、vendor M→L 被拒、店铺 5 字限制不扩字、视觉 get/save/probe/verify 双回环端点、LoginDialog 挂载图片模型且 Key 输入为空/原文不出现、工单旧链接回落、损坏 vision 后普通启动/文字训练正常，并在 finally 恢复原 vision 文件字节/不存在状态后 restart。证据：`artifacts/size-vision-20261118/final-guard-wiring-report.md`、`final-integration-fix-report.md`、`native-final-fix-report.json`、`native-final-size-rules.png`、`native-final-login-vision-safe-key.png`、`native-final-workorder-entry-removed.png`。

未执行：将本分支合入 main、push、分支删除、真实平台/买家/付费模型/生产、辅助中心原生截图（harness 未注册 assist；辅助 19 项单元通过）、独立视觉知识图片原生学习（复用 53 项真实回环学习测试）。发布新版已获用户授权但尚未执行，由 root 通过现有 GitHub 全量检查/原生/云 package 后发布。下一项：root 合并/推送/正式 profile 重启与 Release，验收条件为 main 合入后同版本 build 与原生入口无回归。

## 2026-11-19：进店欢迎自动保存与紧凑布局（1.0.72）

## 2026-11-19：配置中心嵌入工作台（1.0.73）

配置中心路由改为 MainLayout 子路由，保留 /shop/manage 及全部 query/旧链接；与店铺首页共用原顶部导航、账号、AI和窗口控制，只切换下方内容。配置时隐藏店铺列表，使用配置功能侧栏；回首页保留店铺选择、搜索和折叠状态。删除配置自身顶栏及返回工作台、商品自动学习、官网按钮，内容高度适配剩余空间。复用既有 route watcher 隐藏/恢复原生店铺页，不新增业务命令或依赖。

相关验证：4文件20项测试、vue-tsc、改动ESLint、build退出0；真实隔离Electron config:embedded-workbench 与 dialogs-and-navigation 2/2，通过顶栏DOM同一性、配置高度、按钮删除、导航高亮、首页返回及直接链接断言。截图 artifacts/desktop-selected-1795024641713/embedded-configuration.png 已查看。一次独立审查未发现实际问题；仅本次范围，未运行全量Release验证或调用真实平台/模型。已在主目录快进整合，主目录构建退出0；按原资料路径重开源码，窗口可访问树确认 v1.0.73，原两家店记录保留。未修改正式配置或发送消息；本批仅本机源码交付，未推送、云打包或发布。

下一项：用户在日常店铺资料下查看首页/配置切换；验收条件为共用顶栏、店铺原生内容正确隐藏/恢复、配置功能正常可达。

本批以最新主目录为整合目标，保留 1.0.70 的 AI 配置接口及 1.0.71 的知识库训练场迁移。仅修改欢迎设置、媒体规则的自动保存及相关向导提示/验证，复用 Vue、Element Plus 和现有业务保存服务，无新增依赖、IPC、vendor 或服务端改动。

- 删除进店欢迎中的“保存配置”和“保存接待规则”。欢迎文字失焦保存，开关及有效延迟变更立即保存；收到真实回执后才提示“保存成功”。空操作不提交，失败保留输入；连续修改、失败重试、工作区/店铺/卸载租约及 CAS 保留。
- 欢迎媒体位于延迟右侧并居右，文字保持整行；窄窗口换行。有效地址失焦、已审核视频选择及删除媒体自动保存。空白新行不冒充已保存；权威规则未载入时不写入，保留隐藏欢迎文字；删除最后一个媒体会删除空规则，连续替换不改变原启用状态。
- 导入复用模式的欢迎文字仍随向导最后保存，媒体保持独立自动保存。保存服务新增有租约检查的确认队列，避免忙碌时丢弃媒体修改。

Codex 主目录独立验证：8 文件 34 项相关测试、Vue/Electron 类型、改动文件 ESLint/格式和依赖边界、主目录 build 通过。隔离真实 Electron 的 `business:welcome-timing-settings` 检查 1/1，通过实际文字失焦、延迟变更、媒体新增/删除最后项、成功提示及左右布局/控件无溢出断言；报告 `artifacts/desktop-selected-1795022435495/report.json`，截图 `artifacts/desktop/welcome-timing-settings.png` 已查看。测试仅使用临时离线店铺记录，不打开平台或发送媒体。

主目录日常资料路径已重启，真实窗口确认 v1.0.72。未更改真实配置、未发送买家消息、未公开发布或生产部署。云端构建和产物验收以后续回执为准。

## 2026-11-19：迁移原生验收接线与冷启动修正（同批1.0.71）

首轮CI 44353252685全量源码检查通过，原生92/94；两失败为旧sidebar训练断言及未装配knowledge IPC的旧训练路由验收。验收harness现复用生产createKnowledgeWindow/registerKnowledgeIpc/loadRenderer，验证真实知识库训练标签、问答表单和临时店铺选择。定向原生首次1/2另复现旧链接冷启动快照竞态，配置页现等待runtime.refresh后取店铺，并拒绝已离开路由的晚到打开。最终原生2/2、相关单元14/14、Electron TypeScript检查通过，界面构建退出0；未改正式知识库数据或发送消息。新版源码此前本机已显示1.0.71并验过商品行预选与切店；最终云端结果随后补充。

## 2026-11-19：训练场知识库迁移整合（1.0.71）

已保留主线 accbcc3 的关键词配置和 AI 配置接口，训练入口迁入知识库“商品”右侧，并在商品行加入自动预选入口。Codex 独立审查补充修正：普通快照刷新保持训练组件挂载；隐藏/新窗口上下文更新训练会话代次，拒绝迟到回复；失效商品保留明确预选并禁止提交，不静默退为通用问答，用户可显式选择“不指定商品”。仅复用现有训练与知识库服务，无新增依赖。

独立验证：将 backend.snapshot 模拟为每次返回新对象后，新增回归先 RED（4失败/7通过），修复后 11/11 通过；与最新主线整合后 9 文件 98 项通过（含关键词自动保存与 AI 配置读取），完整 typecheck 与改动范围 ESLint 退出0。首轮 DeepSeek 退出0且 final.reason.kind=completed，其相关既有131项及build通过记录保留。未将合成回答当作真实模型验收，未调用付费模型或发送买家消息。最终主目录构建与桌面窗口验收结果随后追加。

## 2026-11-19：AI训练场迁入知识库（1.0.69，隔离 worktree 待独立验收）

训练场从配置中心侧栏迁入知识库商品 tab 右侧；固定使用知识库当前店铺，商品下拉按现有 products 查询分页读全并显示名称/编号。商品卡“AI训练场”只切 tab 和预选本行 storeId/productId，发送测试才调用 `start-training`。切店/切商品清空历史并丢弃迟到回复、错误和旧商品列表；图像测试、错误状态和清空历史保留。旧 `?panel=training/sim`、ShopOpsPanel 图片入口和店铺设置助手均打开知识库训练 tab，旧独立训练面板已移除。

验证仅为本次直接范围：新增训练/兼容测试 9 项及既有相关知识库、店铺设置、ShopOpsPanel 11 文件 131 项通过；typecheck、改动 ESLint/Prettier、`npm run build` exit 0。未跑全量 check/desktop、未打开真实店铺、未调用真实模型/买家、未打包/提交/推送/部署。版本 1.0.69 与 lock 已同步：开工时主树为 1.0.68，但任务中主树先由其他任务提交 `be1755c` 到 1.0.69，后由合并 `accbcc3` 推进到 1.0.70；本分支按开工时派单保留 1.0.69，现已低于主树，整合前须处理版本回退/重升。设计与实际回执见 `docs/superpowers/plans/2026-11-19-training-knowledge.md` 和 ignored `artifacts/training-migration/worker-report.md`。

## 2026-11-19：AI 配置接口集成验收（接口交付版 1.0.70）

最终回执：`accbcc32526ff8405b92eff972d7d71447dd8a89` 已合入并推送 main；[完整桌面 CI 44350540091](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44350540091) 成功（181 文件/1408 单元、242 上游，Electron、知识库/资料学习及打包检查全部通过）。同次 installer/ZIP/manifest 的 SHA256 全匹配，manifest 精确绑定 1.0.70、该提交和该 run。下载的 ZIP 在本机复用 package-smoke 通过全部 10 项，MCP 与 CLI 连接器逐字节匹配主目录本机构建；打包 CLI 显示 1.0.70 并成功只读连接运行实例。

主目录源码已正常重启，PID 142636，无诊断参数，窗口可访问树明确显示 v1.0.70。标准 MCP 实例只读验收为 14 工具/三配置组，两店欢迎语和识图配置均可读；CLI status/stores/get 实测通过。原 profile、两家店及 AI 全部关闭保留，未修改真实配置或发送消息。证据位于 `artifacts/ai-configuration/`，云包位于 `release/ci-accbcc3-ai-interface/`；没有创建公开 Release 或部署服务端。后续主线的 1.0.71 训练迁移已保留本接口；本段云包和运行回执仅对应已验收的 1.0.70，不替代其他任务的新版验收。

接口初始候选 ad104c0 已由 Codex 独立检查：定向 8 文件 50 项、完整 typecheck、完整 build、改动 ESLint/Prettier 均通过，标准 MCP 与 CLI 子进程均有端到端验证。独立审查发现的连接文件错误内容泄露、版本字段说明、晚到账号回执和识图预览问题均已修复并回归。

同批工作期间主线新增关键词配置提交 be1755c（1.0.69）。本候选在隔离工作树合并该已提交主线，只在 HANDOFF 保留双方文字记录；关键词原有源码、vendor 和配置契约相对 be1755c 无差异。最终接口版本调整为 1.0.70，package 与 lockfile 一致，未搬移另一任务的未提交改动。合并后同一 50 项回归、完整 typecheck 和 build 通过，证据在 ignored `artifacts/ai-configuration/merged-*.log`。最终主目录运行及同源云包验收待后续回执。

## 2026-11-19：AI配置接口（初始源码候选 1.0.69，MCP+CLI）

用户已确认 MCP + CLI 共用运行中软件的认证 gateway；本分支只实现 `reply-pacing`（全局）、`welcome`（按店）和 `vision.enabled`（按店）。新增 `lingtu_config_schema`、`lingtu_get_config`、`lingtu_preview_config`、`lingtu_apply_config`，保留原10个MCP工具；新增 `lingtu-cli.cjs`（`status`、`stores`、`config schema/get/preview/apply`，`node:util` parseArgs，`--json`参数或stdin，`--connection-file`，非0失败）并接入源码 `npm run ai` 与安装版 `resources/ai-interface`。未新增依赖，未改 vendor、node_modules、真实 userData 或真实配置。

保存复用 `save-config`+REPLY_PACING 的完整 `expected`、`save-welcome` 和 `save-vision-settings` 的原生 `version` CAS；预览不执行命令，apply 回读新快照实际值。旧工作区/店铺/版本、未知或空字段、并发界面保存、重复requestId、识图能力不支持均被拒绝；账号在写入过程中变化时不返回成功。CLI 不回显损坏连接文件内容或token，写操作不自动重试。

实际验证：最终定向套件 **5文件35项通过**（`tests/agent-settings`、`agent-config-lifecycle`、`agent-config-persistence` 真实厂商后端本地夹具、`agent-config-cli` 子进程、`agent-interface` 标准MCP Client），日志 `artifacts/ai-configuration/logs/green-final-agent-suite.log`，exit 0。RED 证据：`red-task1.log` 13 failed/1 passed（工具未注册）；`red-task2.log` CLI入口缺失、apply注解仍为只读。新增连接文件泄露用例在修复前曾 1 failed/8 passed（`green-task2-cli-debug.log`）。`tsc -p config/tsconfig.electron.json`、`vue-tsc --noEmit`、改动范围 ESLint/Prettier、边界检查、`npm run build:desktop` 均 exit 0；已生成 `dist-electron/lingtu-mcp.cjs` 与 `dist-electron/lingtu-cli.cjs`。首次 Electron typecheck 的2个索引签名错误日志保留，修复后复跑通过。

未做：真实账号/店铺配置写入、真实模型或买家发送、完整安装包、全量 `npm run check`/`npm run test:desktop`、应用重启/推送/部署/发布。打包仅更新 `extraResources` 白名单，安装器验收和源码重启由集成者执行。下一项：Codex 独立复核、按需修复、集成并重开最新源码。

## 2026-11-19：接待关键词紧凑双栏与自动保存（1.0.69，隔离工作树；待主管整合）

用户要求在转接人工接待区将“全局人工关键词”和“客服接管关键词”改为左右等宽、紧凑等高文本框，各自带启用开关，并移除“保存配置 / 保存全局关键词 / 保存客服接管关键词”三个按钮。本批只在 `C:\Users\90760\.codex\worktrees\keyword-settings\client` 实施，未合并主目录。

已完成：

- `ShopOpsPanel` 的转接区改为两列等宽卡片，两个 textarea 均为 3 行；每个卡片头部含独立开关。全局标题明确“仅影响继承全局配置的店铺”，客服接管标题保留“客服发出后暂停当前会话 AI”。关键词原文与开关分离，关闭不清空文本框。
- 文本在 textarea 失焦/点击外部时自动保存；未修改的失焦不发请求。开关变更立即保存。成功且页面租约仍有效时才调用 `ElMessage.success('保存成功')`；失败写入当前面板错误并保留草稿；切换开关失败会回退开关，不回退文本草稿。
- 每个字段独立串行队列，可在旧请求等待时保留最新失焦草稿；不共用 `task.pending`，不会因一个字段保存中而丢失另一个字段的编辑。成功回执同时校验 workspace、店铺、view、loadRevision 与卸载状态，切店/切视图/切工作区/卸载后的迟到结果不提示成功、不回填。
- 全局与客服接管关键词都使用 `save-config` + `RECEPTION_KEYWORDS`。主进程严格解析 `keywords|enabled` 两种模式，关键词逐项 trim/去空/去重、每词最多 30 字、最多 100 个；全局保存增加预期旧值检查，客服接管沿用既有 CAS。主进程按顺序串行读改写，避免交错覆盖。
- 开关保存在本工程 `reception-keyword-settings.json`（严格 schema、临时文件改名原子写、未改原文件时失败不覆盖）；关键词原文仍保存在厂商 ConfigStore。旧账号缺失开关字段时按原先“开启”解释。
- 厂商 `backend.cjs` 仅增加可选 `resolveKeywordSafety` 注入点：ReplyEngine 读取配置时只替换生效的 handoff/manual 数组。全局开关关闭时继承全局的店铺不再匹配买家转人工词，但本店自定义关键词优先且保留原语义；客服接管开关关闭时仅停止卖家侧接管词匹配。原生接待操作的 `transferKeywords` 也走同一过滤，未开启开关时不会触发转接请求。未注入该回调时上游行为不变。
- 转接区的“继承全局关键词”和本店自定义关键词也改为失焦/切换即时自动保存；复用向导的 `deferredSave` 仍只向上传递草稿，不单独写盘。全局与客服接管关键词在复用时仍独立自动保存。
- `package.json` 与 `package-lock.json` 统一为 1.0.69；`vendor/lingtu-runtime/source-files.json` 更新实际 sha256/localPatch，PROVENANCE 记录最小 hook 来源与边界。

验证（仅本批相关，非全量）：`npx vitest run tests/reception-keyword-autosave-races.test.ts tests/reception-keyword-settings.test.ts tests/shop-setup-wizard.test.ts tests/shop-setup-reuse-wizard.test.ts tests/shop-ops-panel.test.ts --maxWorkers=1 --no-file-parallelism` 为 5 文件 59 项通过；`vue-tsc --noEmit`、`tsc -p config/tsconfig.electron.json --noEmit`、改动文件 ESLint、Prettier check、`node scripts/check-boundaries.mjs`、`npm run check:vendor`（vendor 80 / server 97）和 `npm run build` 均退出 0。构建保留既有 Zod 注释与 >500kB chunk 警告。

未执行：全量 `npm run check`、全量 `npm run test:desktop`、真实店铺/平台消息/模型请求/买家发送、真实重启进程、安装包/发布/部署、截图验收；未提交、未推送。下一步由主管整合主目录，并在合并后的桌面实例确认双栏布局和重启后开关恢复。

## 2026-11-18：主干整合验收（1.0.68，设备授权注册回跳；已合入 main 并实际启动）

以 `07a2ac6` 为基线、用 `git merge --no-ff` 整合 `a28750d`（`codex/device-registration-redirect-20261117`，base `377193d`）保留真实父历史，只重放设备授权注册回跳成果：`server/patches.json` 为 `web/src/features/auth/sign-up/components/sign-up-form.tsx` 与 `web/src/features/auth/sign-in/index.tsx` 追加 redirect hunks，并新增 `web/src/features/auth/sign-up/index.tsx`、`web/src/routes/(auth)/sign-up.tsx`、`web/src/features/auth/hooks/use-auth-redirect.ts` 三个补丁键；纳入 3 个新增自有 auth suite、更新后的 `admin-login-hint.test.tsx`、`server/source-files.json`（97 条，全部 hash 匹配）与 `server/PROVENANCE.md`；`server/scripts/verify.ts` 仅向既有 CI 输入追加这 3 份 suite 与 3 个实际改动 lint 文件。main 既有成本/支付/主图采集/PDD 实店修复/欢迎回执/调试 gate 与全部 guard 保持，原 95 个补丁 hunk 与 94 条旧 manifest 条目 0 丢失；`package.json`/`package-lock.json` 统一 1.0.68，无依赖变化；`vendor`/`electron`/`src`/CI/Go 零差异。

提交与历史：auth merge `b3a5f69`（父 `07a2ac6` + `a28750d`）；5 个已证明覆盖的 ref（runtime-refactor、taskbar-icon、progress-site、两个 docs/lingtu-ecosystem）以 `-s ours` 登记为 `121fffb`，其 tree 与 auth merge 完全相同（`5f46ae2c…`，`git diff --exit-code` 为 0）。全部 named 本地/远端分支均为 `121fffb` 祖先；5 个未吸收的 `codex/snapshots` 为备份并已审计（无可直接整合的独有完成代码，不能 merge 旧根）。87 个原 dirty 文件 hash 完全不变，3 份 stash 与 30 个工作树保留；功能整合时 `main` 与 `origin/main` 指向 `121fffb`；最终主干另含同批文档回执，相对该 CI/build 源码基线仅四份文档变化。

实际验证与 CI：server 4 个 auth suite **9 项通过** + 既有 auth sanitizer **6 项**；`prepare.mjs` exit 0 与 `preparation.test.mjs` **2/2**；网页 typecheck、变更范围 oxlint、oxfmt、网页 build 全部 **exit 0**；根目录独立 **5 文件 15 项通过**；隔离 `07a2ac6` baseline 先跑 **8 项失败 / 7 项通过**（RED 全部落在被修行为断言）；根桌面 build **exit 0**、server-tools TypeScript **exit 0**；`check:vendor` 80/97、`git diff --check` exit 0。两条 CI 均对 exact `121fffb` 成功：[desktop 44335250367](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44335250367)（175 文件/1366 单元、上游 242、native 94、知识 18+7、packaged 10）、[server 44335249564](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44335249564)（13 文件 72 网页测试、11 个 verify 步骤全 0、隔离 SQLite/MySQL/PostgreSQL 通过）；证据已由同 run 下载核对，未发布 Release、未部署。

启动与边界：主目录源码 build exit 0 并实际打开 1.0.68（PID 18076，`E:\~1awucheng\Plastic SCM\AI电商客服软件\client\node_modules\electron\dist\electron.exe`），使用原 profile、两家店铺记录保留、AI 均关闭、店铺页未打开、无 debug flags 与安全弹窗。旧 1.0.67 在 Alt+F4 后仅窗口消失、后台进程未退，Codex 按路径核验后只结束已知旧实例进程（`115308` 等），**不记为正常退出**，仅作观察/后续诊断，不扩大改运行时。

未做与未交付：未新增实店消息、未做真实账号注册/设备确认 E2E、未发布 Release、未部署。旧 React/CJS 尺码结构化模块（2 项 RED 未完成）与视觉模型独立配置（仅设计）未作为功能交付。本批 1.0.68 不再升版本，后续仅文档跟进。

## 2026-11-18：1.0.67 最终整合（1c221df 实店验收代码 + 00a7ec6 PR39 商品主图修复；云验收与正常启动通过，main 已整合）

`ShopOpsPanel` 的欢迎保存改为消费 `save-welcome` 返回的权威已存记录：仅接受通过 `welcomeSettingSchema` 校验的 `result.data`，更新本欢迎 baseline/cache/CAS version，不再在成功后立即 `load()` 可能仍落后的 snapshot。回执同时写入现有按 workspace/store 隔离的 scoped draft-cache，只覆盖该店欢迎的权威已存记录供嵌入区卸载重建回读，不写回其他字段。保存期间的新输入保留；快照暂时低于已确认版本不误报冲突，真正更高版本仍提示冲突并阻止覆盖。未改共享 runtime、backend/CAS、PDD 发送/授权/hook/collector 或版本。

本分支 `codex/pdd-1067-integration-20261118` 以 1.0.66 实店验收代码 `1c221df` 为基线，合入 `origin/main` `00a7ec6`（PR39 商品主图采集修复）。保留双方代码：`electron/platform-product-dom.ts` 与 `tests/platform-product-dom.test.ts` 和 00a7ec6 逐字节相同；hook/reply-engine/shop-window/DOM 发送/授权/monitor 源码和 1c221df 逐字节相同。`package.json` 与 `package-lock.json` 统一 1.0.67。

1.0.66 实店用户已确认 A/B/A 与 3 个不同商品，6 条 app candidates 均 sent，trace/card/source title 一致，native 自身回复唯一、另一买家 0；A→B 19:42:26.294、B→A 19:43:54.994，3 个不同商品短哈希 9B3213594CBA/FD05E46B5441/F8A9D9BEF823。最后一次 A 实际是第三件，不能写成原商品回切；.66 三轮实店归属复核通过并已正常启动。**1.0.67 没有新实店发送**：本轮未新增真实买家消息，实店结论只沿用 .66 的上述记录，不把 .66 发送算作 .67 送达证据。

首次云 CI `44299800997`（head `080392d`）桌面验收 `93/94`，唯一失败 `business:welcome-timing-settings`：欢迎保存成功后旧分支 `cached.delete + load()` 读到被后续刷新抢走 ticket 的落后快照，textarea 被清空。仅按该失败局部修复 `ShopOpsPanel` 欢迎回执（消费 `save-welcome` 权威 `result.data`）并新增 `tests/shop-ops-welcome-receipt.test.ts`，未改共享 runtime/backend/CAS、PDD 发送/授权/hook、原生断言或产品其他行为。

本机验证：最终 7 用例在 0803 baseline RED 5 fail / 2 pass，修复后 GREEN 7/7；合并前两项基线 31/31；合并后定向 7 文件 92/92；root 独立 43/43（4 文件）及完整 native 94/94；typecheck、改动 ESLint/边界/Prettier、check:vendor（80/94）、完整 build 通过；真实 Electron 五项 5/5（离线合成夹具，临时 userData，无真实店铺/网络/发送/模型）。日志、diff、worker-report 在 ignored `artifacts/pdd-1067-integration-20261118/`。

最终云验收：[44306942021](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44306942021) 对 commit `fb9bcb28acbe56f13c7e2c1b96f04e3f80e02427` 成功；Unit `175` 文件/`1366` 测试、上游 `242/242`、native `94/94`、knowledge manager `18`/ingestion `7`、packaged `10` 项均通过。installer/ZIP/manifest 三项 SHA256 匹配，manifest version/sourceCommit/workflow 精确；解压版 package-smoke exit 0。ASAR 的 hook/reply-engine/shop-window 与当前源码及 1c221df 已验收源逐字节相同，`main.cjs` 含 PR39 三个 ASCII 标记。证据见 `artifacts/pdd-1067-integration-20261118/cloud-acceptance-final.json`。

1.0.67 正常启动验收（2026-11-18 20:59:14，实测）：从 `release/ci-fb9bcb2/unpacked/LingtuAI.exe` 启动，PID `115308`，无诊断参数，界面版本 `1.0.67`；仍用原 profile `yunduo-ui-restored`，原两家店铺保留，米配匠连接成功且 A/B 历史画面正常显示，两店 AI 均保持关闭；旧 1.0.66 正常关闭，诊断端口监听为 0。启动时的 Windows 网络安全弹窗已由用户手动关闭，Codex 于 22:08 实测复核弹窗画面消失、1.0.67 窗口可用、米配匠在线、A/B 历史与历史商品卡可见、目标店 AI 关闭、诊断端口监听 0，且本次未发送买家消息；第二家店铺窗口未打开。启动事实见 `artifacts/pdd-1067-integration-20261118/codex-normal-startup.json`，关闭后复核见同目录 `codex-post-firewall-final.json`。

main 整合回执：本分支已快进并入 `main` 并推送，`main` 的最终提交即本轮文档回执提交。打包与云验收代码固定为 `fb9bcb28acbe56f13c7e2c1b96f04e3f80e02427`，其后只有 `docs/HANDOFF.md` 与 `docs/VALIDATION.md` 两份文档跟进，产品源码与该 SHA 逐字节相同，因此不重新打包、不升版本（仍 1.0.67）。Windows 网络安全弹窗已由用户手动处理并经 Codex 画面复核通过，1.0.67 启动验收无剩余待办。1.0.67 没有新增买家发送，实店证据仍只对应 .66。

## 2026-11-18：PDD 新商品卡来源最小修复（1.0.66 / hook v15，Codex 独立预审可进入 CI；实店新卡待测）

实店验收侧后续报告 1.0.65 A/B 真实收发通过，已覆盖下方 1.0.65 诊断节的旧未通过状态；原正式云包进程 91888 继续保留验收。本隔离树未访问该进程、Inspector、正式用户数据或旧源码。**新商品卡仍待实店实测，不能把本节离线 GREEN 写成实店通过。**

已确认事实：type41 买家入口卡在 `message.info.goods_info.goods_id/goods_name` 有显式商品字段，type0 分享卡在 `message.info.goodsID/goodsName`；旧 v14 的 `normalizeNode` 只读顶层，store `ingestConv` 与 DOM `scanBubbles` 也不携带同 msgId 商品，所以新显式卡会丢商品。当前新纯文字 turn 的 product 为空是 expected unknown，历史卡不得回填。

本批只改 hook v15：新增有界 `productOf`，保留原顶层字段优先级和字符串口径，再仅接 type41 `info.goods_info`、type0 `info.goodsID/goodsName`；新增路径只接受 6–32 位明确数字 ID/安全原始类型和字符串标题，不递归、不猜 ID、不扫入口正文/URL/JSON、不调用 `recommendGoods`、不读联系人预览。`normalizeNode`、`ingestConv`、`scanBubbles` 统一透传，event 增加同卡 `goodsId`；DOM 仅从同 UID、同 native msgId 的 Vuex 条目取，先过原 UID/行 ID/角色守卫。商品只赋给该卡所属 UID 的新 pending row，同一未处理 row 保留既有绑定；bootstrap/水位/去重旧卡、纯文字、错 UID 和角色冲突不回填。未新增全局/跨请求缓存，未改发送、授权、节奏、窗口、知识或平台配置。

验证：新增 21 项商品来源测试先 RED（最终 `logs/red-targeted-v14-final.log` 6 失败/3 通过；Codex 边界预审 5/6 失败），修复后 21/21 通过，Codex 独立 7/7 通过；PDD/发送/监控定向 13 文件 189 项通过；真实 `ShopWindowManager` + hook 的 `dom-send:pdd-product-source` 与 v15 真实中间行 2/2 通过（`artifacts/desktop-selected-1795000022298/report.json`，临时 userData/合成 data HTML/无真实网络）；typecheck、改动 ESLint/Prettier、check:vendor（80/94）、upstream 242/242、完整 build 退出 0。完整日志、失败记录与 diff 见 ignored `artifacts/pdd-product-fix-20261118/worker-report.md`。

**未执行**：实店/91888、Inspector、真实平台消息、真实买家发送、AI 开关、模型、重启 GUI、打包、commit/push。实店新卡是否到达、A/B 不同商品能否隔离、候选商品显示与最终收发仍需 Codex 和实店独立验收；本修复只保证：受支持的 Store/DOM/有正文 WS 通道中，新显式 type0/41 卡会透传商品；info-only WS 仍不支持，需同 nativeId 的 Store/DOM 承接；仅有 ID 但正文与同源标题都为空的卡仍 unknown/不入队。因此不承诺商品来源实店通过。

**历史状态标注**：本节“实店新卡待测”的历史待测状态已被上方 1.0.67 节的实店记录覆盖（.66 实店 A/B/A 三件不同商品、6 条 candidates 均 sent）；本节只保留当时的离线预审范围与失败证据，不回改实店结论。

## 2026-11-18：PDD 发送诊断修复（1.0.65 / hook v14，待 Codex 独立复核）

**A/B 实店发送仍未通过，不能写成送达。** 已证：B 在平台机器人回复后从 `todayChatFilter` 待回复分组消失，`conversationFor(B)=null` 导致 `reviewHistory known:false`，尽管 current/原始列表/nativeID 有 B；A/B 底层均 `input_busy`，真实全屏 leave 层覆盖发送按钮，但 detail 当时丢失，不能唯一归因。平台自带机器人回复不是本软件送达。

本批只做三项最小修复：

- hook v14：`conversationFor` 原 getter 优先，仅目标缺失时只读精确补查原始三个列表；同 UID 多份 latestID 冲突（含一份有 ID、一份无 ID）fail closed；单份/全部候选都无 ID 时不由缺失本身直接判 null，仍由 current/listed、行 ID、DOM/Vuex role 校验决定。无冲突时同 latestID 也走全套校验；fallback 不扩大 `scanStore/conversationsOf`，但通过归属验证后可恢复当前目标 DOM 采集，不能写成所有采集范围完全不受影响。current 不作单独归属证据。
- reply-engine：只在 `reply:review-result` 和发送失败 `reply:failed` 发 event 前附带 exact allowlist 的 ASCII detail 分类；任意原文/URL/Key/HTTP body 变 `unclassified`。ReviewConsole 再按同一 20 项 allowlist 边界防御并写 `发送分类: <code>`；reason、状态、授权、点击次数、不重发不变。
- shop-window：仅 `pdd-web` WebContentsView 设 `backgroundThrottling:false`，其它平台不传该键保留默认 true；无全局 CLI flag，不改 opacity/style/弹窗/发送 guard。

验证：定向 9 文件 106 项通过；真实 `ShopWindowManager` Electron 覆盖窗检查 2/2（v14 中间行 + 后台 rAF），原 true 在 host 主窗偏好下行为 RED timeout 1829ms，修复后 PDD 后台 rAF 0ms 通过、非 PDD 只断言属性默认 true；typecheck、check:vendor（80/94）、upstream 242/242、build 通过。日志在 `artifacts/pdd-send-fix-20261118/logs/`，完整范围/未测项见同目录 worker-report。

**未执行**：实店、Inspector、平台消息、AI 开关、发送、重启 GUI、打包、commit/push。新 hook 的真实 A/B 归属、覆盖弹窗期间 hit/回显与实际送达仍待 实店独立验收（CI 由 Codex 安排）；本机结果不冒充实店通过。

## 2026-11-18：1.0.62 实店基线未通过与 PDD 真实消息行投影修正（1.0.64，hook v13，待独立复核）

**1.0.62 实店基线未通过**：绑定目标店（idHash 5499ABA4B691，wcId=2）两买家 A/B 手工 focus 成功、selected/currentUserInfo/列表选中三路一致，但 `reviewHistory` 均为 `known:false`，首个 false 是 `dom_text_not_in_known_texts`（pdd-web-hook.js:952）。实店只读复核已撤销“右侧残留旧气泡/消息面板未切完”的旧归因：`BUBBLE_SEL`（`.chat-item p.chat-message-content, p.chat-message-content`）可见的 5 个命中全部位于左侧联系人预览 `.chat-item-box[data-random]`（x=60/108），不是中间消息行；中间真实消息是 `LI#middlePanel_list_<msgId>.clearfix.onemsg`（x=321，内部 `p.chat-message-content` 后代数为 0）。因此守卫拒绝的是被伪装成气泡的联系人预览文本，不是登录或 UID 误判。

同店后续只读采样（wcId=2，当前 UID B）确认真实结构：19 条 `middlePanel_list_*` 行与 `currentUserInfo.messageList` 19 条一一对应；方向标记是行内 `DIV.cs-item`（商家/客服，`from.role=mall_cs`）与 `DIV.buyer-item`（买家，`from.role=user`）；`DIV.merchantMessage` 是 19 行全部存在的包裹层，**不能**再当卖家痕迹；正文/卡片/图片叶子分别为 `DIV.floor_item.text`、`P.msg-content-box`、`.good-name/.good-price/.good-part`、`.msg-title/.content`、`img` 等，另有 `P.message-time`、昵称、`robot-text`、`menu_item`、`.btn` 等装饰。证据在 ignored `artifacts/pdd-live-fix-20261118/`（`raw/middle-roles.json`、`raw/middle-tree.json`）。

修正（仅 `vendor/lingtu-runtime/desk-v1/src/injections/pdd-web-hook.js` 升至 v13）：删除 `BUBBLE_SEL`，新增统一真实消息行投影 `messageRows()/rowMessageId()/rowDomRole()/rowRole()/rowText()/rowContent()`；`panelMatchesUid`、`scanBubbles`、`reviewHistory`、`sellerEchoCount/waitForEcho` 及 `prepareNativeTextSend/confirmNativeTextSend` 共用同一投影。有 ID 的行由 `middlePanel_list_<msgId>` 唯一证明归属，角色只认同一 msgId 的 Vuex `from.role`（`merchantMessage` 是整块消息区公共包裹层，不作卖家证据）；正文优先用同一 ID 的权威普通文本，图片/视频 URL 与 JSON 卡片载荷不写进正文，退回已核实正文节点；无 ID 的历史 `.chatMessage` 行保留原严格文本归属兜底；任一可见行角色无法证明时 `reviewHistory` 整体 `known:false`，不静默忽略；真实行 ID 取代文本哈希作为 DOM 消息 ID。左侧联系人预览不再进入 pending/review/echo；时间/昵称/机器人/菜单/按钮不进入正文。

版本统一 1.0.64（package.json 与 package-lock.json 本批只递增一次），`source-files.json` 保留 upstreamGitBlob/upstreamSha256 并更新实际 sha256 与 localPatch，PROVENANCE 记录本轮根因与验证边界。1.0.62 已交付产物与本轮证据只对应旧基线；**1.0.64 仍待 Codex 独立复核与实店新消息/商品/发送验收**，本轮未重启、未发送、未调用模型、未改 AI 模式。原冻结 1.0.62 树的 userData 实店进程（97928 提供 49431/49432）保持运行，未关闭/重启/注入 hook。

## 2026-11-18：1.0.62 最终组合验收与主目录正常打开

按用户授权将主目录已交付的回复监控会话视图（bc6a863，父 aaef4df）合入已验收 1.0.61（cbd1d89）。保留 1.0.61 的 PDD 会话/发送门、欢迎缓存、页面批准指纹、取消与生产失败回调修正，同时保留主目录新增的监控会话气泡、商品/trace 同店同买家筛选、ReviewConsole 商品投影、ReplyMonitorView、契约与测试。版本统一为 1.0.62；原 1.0.61 已验收产物仍只对应原基线，不覆盖新增监控。最终源码提交为 28b0103，原始 PDD 输入 aaef4df、监控输入 bc6a863 与整理历史均保留；已通过验收并合入主目录，正常打开 1.0.62。公开 Release 与生产部署未执行。

本机组合验证：定向 15 文件/129 项通过（review-engine 11 项同时覆盖原 10 项发送门与新增 goodsTitle 投影；另含两个 PDD hook、原发送/欢迎/授权/协调器组合、reply-monitor 会话/组件/窗口/开发者及 review-console），退出 0；typecheck、变更 TS/Vue ESLint/Prettier、边界、check-vendor（runtime 80 / server 94）、上游 242/242 和构建通过。原生仅运行 compact-window 与 developer-console，2/2 通过（artifacts/desktop-selected-1794981028351/report.json）；未发现独立监控会话原生脚本。三份发送 TS（dom-text-adapter、send-mode-authorizations、welcome-delay）与 cbd1d89 逐字节一致；主目录 11 个监控单方文件与 bc6a863 快照逐字节一致；source-files 同时保留 hook v12 与 reply-engine 监控实际 sha，PROVENANCE 两边记录并存。Codex 独立复跑同一 15 文件/129 项通过，独立只读复核无确证 P1/P2；计数存在重叠，不相加。

[CI 44247222353](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44247222353) 首次全绿：172 文件/1311 项、原生桌面 91/91、知识库与来源学习、NSIS/ZIP 及真实打包程序 10 项通过。下载 release/ci-28b0103 的版本、精确提交和三份 SHA256 匹配，同一 ZIP 本机首次 10 项通过。原始证据在 artifacts/integration-pdd-20261118/，完整结果见 VALIDATION。

主目录快进至同一源码并构建，正常关闭旧实例后已打开；实际进程和可见界面均为 1.0.62/v1.0.62，原 userData 为 yunduo-ui-restored，临时 inspector 已关闭。两份无关视觉模型文档 SHA256 不变且未提交。未发现本次整合范围内的功能回归；真实 PDD 双买家送达及新监控商品实店显示仍未验证。

## 2026-11-18：1.0.61 组合阶段（云端及产物已验收，最终主目录随 1.0.62 交付）

按用户最新授权整合 1.0.60 整理版与主目录 PDD 修复。原始 PDD 输入已原样保存在 aaef4df，主目录其他两份视觉模型文档保留；当前组合工作基线 b3ed1b6。63 项废弃文件删除、知识库两个专职控制器与 126 项公开接口全部保留。PDD 原始修复、测试和来源/哈希先按快照迁入，再由本机 DeepSeek 按复核反馈补齐测试和最小修正，Codex 独立复核。

组合修正：hook v12 阻止未知方向提前消费去重/水位，要求全部待采气泡有本买家归属证据，并使用无原型字典；普通批准回复持续绑定当前会话，先刷新读取基线，无欢迎仍不等待；发送许可携带批准网页指纹，在同店发送锁内定位后以原始入口核对，避免网页先于归档更新时发送旧正文。复核期间取消在任何填写前停止，已知零填写/零点击的拒绝走合法安全归还队列路径，不触发生产质量暂停；新候选继续重新确认。未改 vendor 引擎、公共失败枚举、IPC 或持久化。

本机验证：DeepSeek 对相关缺口均保留 red/green 原文；组合 15 文件/156 项、后续直接影响 8 文件/67 项通过，Codex 独立发送组合 8 文件/67 项及归属/面板 15 项通过；原生发送/导航/监控 12/12、知识 18+2+5 项、类型/静态/构建、vendor 80/94 文件及上游 242 项通过。计数分阶段且存在重叠，不相加。独立只读复审无剩余确证阻断。详细范围、原始失败与限制集中见 VALIDATION 本轮记录及 artifacts/integration-pdd-20261118/worker-summary.md，避免此处重复全量测试清单。

本阶段版本 1.0.61 已合并原始 PDD Git 父历史并完成标准 CI/产物验收；其后保留并发监控改动，最终主目录由 1.0.62 统一交付；此前 1.0.60 的等待整合状态已被用户本轮授权替代。只使用隔离/离线夹具和模拟模型；真实 PDD 双买家新消息/实际送达仍未验证，未真实发送、未付费调用、未发布或部署。

后续：原始 PDD 父历史已由 bc6a863/1.0.62 merge 纳入；本条 1.0.61 的 CI/产物回执仍只对应原基线，不覆盖新增监控。

## 2026-11-18：第二轮维护整理（1.0.60）

本机 DeepSeek 在独立工作树执行，Codex 复核和整合。清除 63 个确认无外部消费者的还原残留（19 demo、39 图标、ShopPanelShell、GoodsRow 定义、sync 两个空转导、developer-debug 空 barrel），同步移除 GoodsRow 转导。引用核对覆盖代码、Vue 模板、动态加载、构建脚本、测试和打包入口；preload/MCP/fixture 等静态误报已排除，未改活组件模板、legacy CSS、server/vendor 或真实资料。

知识库商品同款创建/元数据/删除预览/解绑/重关联移到 product-family-controller.ts；待学问题状态与处理移到 miss-controller.ts。manager 保留草稿、审核、分页/刷新、账号店铺租约、reset 和销毁；公开 126 项及顺序不变，迁出的 10 方法体经端口映射后 token 一致。原同款 revision 集合、SKU 限制、草稿/命令/关闭/刷新顺序和五项租约条件均保留，独立只读复审无新增阻断问题。

本机相关 10 文件/108 项通过；Codex 独立核心 56 项及旧首页/紧凑监控/真实 CMD 3/3 通过。类型、变更 ESLint/Prettier、边界、构建和知识库原生 18+2+5 项通过；后置 Knip 文件候选为空（仅作静态佐证）。首次 Vitest 临时文件 EBUSY 和随后错误 worker 参数分别保留原日志，串行原断言复跑通过；不计为首轮通过。

当前说明按职责互链，过期任务和 parallel 整合文档标明历史性质，未删除历史验收/设计。大文件中仍保留与生命周期强耦合的 manager 核心、运行时组合根及单领域平台适配器，不按行数强拆。完整范围和证据见 [维护计划](superpowers/plans/2026-11-18-maintenance-round2.md)；日志在 artifacts/maintenance-round2/。

最终独立分支验收基线为 1.0.60 / f89f186：[CI 44148308838](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44148308838) 全绿，源码 169 文件/1268 项、原生桌面 91/91、知识库与来源学习、真实打包程序 10 项通过。下载至 release/ci-f89f186，版本/提交和 ZIP、安装器、清单三份 SHA256 匹配；同一便携 ZIP 本机首次 10 项检查退出 0（ASAR 9124 成员、解析 8 部分）。最终源码构建后的旧首页原生 1/1 通过，截图实测 v1.0.60。未真实操作平台、付费模型或买家发送，未发布 GitHub Release 或部署生产。

整合状态：成果已推送 codex/maintenance-cleanup-20261117，**尚未合入主目录/远端 main，也未重启日常应用**。合入前发现主目录另一任务的 PDD 会话/发送修复及 1.0.59 实店验收现场，已保留其未提交代码、原资料和运行进程，未 stash 或覆盖。本轮最初拟定的 1.0.59 未交付，为避免现场版本冲突改为 1.0.60。已向用户提供保留现场/现在整合的选择；未收到选择时继续保留现场。下一步待实店任务结束或用户明确选择后，整合双方最新成果、验证组合影响，再正常打开主目录实例；不得将本轮隔离截图或便携包验收冒充日常实例已切版。

## 2026-11-18 回复监控会话视图（1.0.59 源码工作树，未提交/未重启；已由 bc6a863 保存并并入 1.0.62）

已按“规划→交互→界面→实现”完成只读监控：当前会话按 `storeId + uid` 精确匹配，左侧买家、右侧我方，系统/未知来源居中；候选（未发送/发送中/失败/平台回执）与真实卖家回显分开，已发送有同文回显时不重复。商品摘要固定在气泡区上方，气泡区独立滚动并默认看最新一条；显示店铺/买家、发送模式、单行状态和一次原因。保留原确认/取消、高级日志和源码版 GM/CMD 展开；未加编辑、删除、质检或任何发送能力。

商品只沿真实生成 trace 的 `reviewContext.productId/goodsTitle` 投影；候选只复制同店同买家 trace。主进程按同店精确 productId 查询现有知识绑定/平台详情，只有现成 HTTPS 图才显示；缺失显示编号/平台标题或“当前咨询商品未识别”，不从模型正文、推荐商品、商品目录、跨店/跨买家数据补全。vendor 仅给 reply-engine 的既有 reviewContext 增加平台行 `goodsTitle`，source-files.json 双哈希/PROVENANCE 已同步。

实际验证：

- `npx vitest run tests/reply-monitor-conversation.test.ts tests/reply-monitor.test.ts tests/reply-monitor-developer.test.ts tests/reply-monitor-window.test.ts tests/review-console.test.ts tests/review-engine.test.ts tests/developer-debug-review.test.ts`：7 文件 63 项通过（含跨店同 UID、买卖/系统/未知、旧候选按时间插入、候选与回显、失败/发送中、商品隔离与未识别、HTTPS 图、原因一次、滚动、确认/取消、GM 隔离）。
- `npx vue-tsc --noEmit`、`npx tsc -p config/tsconfig.electron.json --noEmit`：通过。
- `npm run build`：renderer + desktop 构建通过；保留既有 Zod 注释和 500kB chunk 警告，无新增失败。
- 改动文件 ESLint、Prettier 检查通过；`npm run check:vendor` 通过（vendor 80 文件、server 94 文件）；`node --test vendor/lingtu-runtime/desk-v1/test/reply-engine.test.js` 39/39 通过。

未执行：真实店铺、真实买家消息、打包安装包、全量 `npm run check`/`npm run test:desktop`、提交/推送/重启。`package.json` 版本未改（按用户要求由 Codex 整合时统一更新）。已知限制：商品标题/图片依赖已采集的平台详情或知识绑定；归档晚于实时日志时先显示真实消息事件；商品切换识别依赖下一次真实生成上下文。下一项：整合时统一递增版本并跑 Release 全量，补一次 340×300 受影响界面截图；验收条件为商品摘要与最新气泡同时可见、系统/未知来源不冒充买卖方、候选与真实回显不重复、确认/取消/高级日志/GM 展开不回归，旧快照缺商品字段仍能解析。

## 2026-11-18：1.0.58 整理后最终验收与正常打开

本机 DeepSeek 执行、Codex 独立复核。最终验收提交 fadc03d（1.0.58），[CI 44137539038](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44137539038) 全绿：源码 169 文件/1268 项、原生桌面 91/91、知识库与来源学习、打包及真实打包程序 10 项检查通过。初次 CI 的 cwd 断言误写本机目录名 client，最终仅验收脚本修正，另补真实 xterm 键盘及打包回复监控检查；未额外改产品行为、未重复升级版本。

安装器/ZIP 下载至 release/ci-fadc03d，版本/提交和三份 SHA256 匹配；同 ZIP 本机首次产物验收 10 项通过（ASAR 9124 成员、解析 8 部分）。主目录重新构建、正常关闭旧实例后打开，进程与可见界面实测 1.0.58/v1.0.58，原 userData 保持不变，临时 inspector 已关闭。完整范围、失败历史与证据见 [1.0.58-acceptance.md](1.0.58-acceptance.md)。本次范围内未发现整理引入的功能回归；真实平台、PDD 弹窗实店、付费模型/真实发送未执行，未发布或部署。下一步仅在相关业务获授权时做实店验收，不把模拟链路冒充实店验证。

## 2026-11-18 回复监控左下统一入口与源码 GM/CMD（1.0.58，源码工作树）

已按批准的 `docs/superpowers/specs/2026-11-18-developer-console-design.md` 与 plan 完成实现，不只出计划。主工作台右上角监控按钮移除，工作台左下与“快捷回复”并列、版本独立下一行；配置中心左下也提供同一入口，均调用原 `open-reply-monitor`。默认仍是 340×300、parent 左下、`showInactive`、不置顶；源码版底栏“开发调试”在同窗展开 960×620，左 340 保留回复信息/确认/取消/高级日志，右侧 GM 指令/CMD，720px 以下上下排列。关闭窗口结束终端会话，收起保留，重新进入标签不重连/不重建 shell。

新增 `electron/developer-debug/`：`app.isPackaged` 主进程 gate、owner + workspace + 监控主 frame 绑定 IPC、固定 GM 注册表（help/status/stores/logs [n]/pdd-popup status|allow|block）、按店 pdd-popup 内存策略、node-pty ConPTY 宿主。普通 preload 编译时关闭调试桥；源码监控由单独 `developer-preload.cjs` 提供，且不在 electron-builder files 白名单。node-pty 在 esbuild external、点击连接时动态 require；xterm/FitAddon 只在首次进入 CMD 标签异步加载。前端通过 `src/modules/auxiliary/services/developer-debug.ts` 使用 shared 窄契约，不直接访问 Electron/Node。PDD 策略只接受厂家 `webContentsOf(storeId)` 的实际 PDD WebContents，核对 `mms.pinduoduo.com`，不按 `BrowserWindow.fromWebContents===null` 判断内嵌页，也不改 vendor；block 恢复外部打开 + deny，allow 仅 HTTP/HTTPS/about:blank 且子窗 sandbox/contextIsolation/nodeIntegration 配置安全，正常重启复位。

实际验证：

- `npx vitest run tests/developer-debug-gm.test.ts tests/developer-debug-pty.test.ts tests/developer-debug-bridge.test.ts tests/developer-debug-review.test.ts tests/developer-terminal-lifecycle.test.ts tests/reply-monitor-window.test.ts tests/reply-monitor.test.ts tests/reply-monitor-developer.test.ts tests/main-sidebar.test.ts tests/shop-manage-monitor.test.ts`：10 文件 49 项通过（含 owner/过期输出、IPC 同步 capability、preload source gate、终端异步卸载/工作区/早到输出、折叠展开、两布局入口和 GM Enter 隔离）。
- `npm run typecheck`、改动范围 ESLint/Prettier、`npm run build` 退出 0；构建产物确认普通 `preload.cjs` 无 `developerDebug` 暴露，`developer-preload.cjs` 存在且不在安装包 files 白名单，main 动态 `require("node-pty")`，xterm 为独立异步 chunk。
- 隔离原生 `LINGTU_DESKTOP_CHECKS=business:developer-console node scripts/run-desktop.mjs`：1/1 通过，报告 `artifacts/desktop-selected-1794934378917/report.json`，截图 `developer-console.png`。使用临时 userData 和真实 Electron/ConPTY，验证：主窗无调试桥；监控 340×300→960×620、parent/非置顶；GM help；真实 CMD 中文、方向键历史、Ctrl+C、resize、收起再展开同一 session；关闭监控后新窗口新 shell，旧 session 写入被拒绝。stderr 仅有旧 session `pty-write` 的预期 IPC 拒绝日志，未影响报告/退出码。
- Codex 整合：合入 main 至 beddc49，统一版本 1.0.58。独立定向回归 14 文件 69 项、完整类型检查、改动文件 ESLint 与构建通过；整合后原生检查 1/1 通过（artifacts/desktop-selected-1794934538521）。真实 Electron 子进程验收确认 disconnect/dispose 后 CMD 与独立 console 子进程均已结束，清理 Promise 贯通 runtime disposer。普通 preload 编译无同步探测/调试桥；产物验收新增 ASAR 排除 developer-preload/node-pty 和实际 bridge 缺失断言。已补齐随渲染资源分发的 xterm/FitAddon MIT 原文。未运行本机全量 Release 检查；最终验收已完成：GitHub Actions 44137539038（源码提交 fadc03d56d278469581368985e0800b7f8d6d11e）全流程通过，桌面 91/91；安装器、ZIP 与 manifest 已下载并逐项核对 SHA-256，下载的 1.0.58 在隔离资料目录运行 package-smoke 通过，确认左下监控入口和打包版无开发调试桥/控件、ASAR 无 developer-preload/node-pty。主目录已锁定安装依赖、重建并正常重启；实际界面与 GM status 均显示 v1.0.58，实际 CMD 连接成功。证据保留于 E:/codex-builds/lingtu-developer-console-20261118，未发布公开 Release。PDD allow/block 的实店新窗口行为尚未触发验证，未发送真实买家消息、未公开发布。

## 2026-11-18 维护性清理与职责拆分（1.0.56，本机源码）

按用户预先审查的顺序完成三批整理：旧 demo/兼容入口清理、知识库控制器拆分、主进程知识/辅助装配拆分。清理与知识拆分由本机 DeepSeek 在本工作树实现；主进程装配拆分由另一本机 DeepSeek 在独立工作树实现；两者均由 Codex 独立验证并整合提交（清理 206df4e、知识 ecbed7f、运行时装配 3070e00，最终工作树含合入的最新 origin/main 1bea5ad）。worker 未 commit/push/重启；1.0.55 的自定义模型 API 功能由主线合入并保留，不属于本批实现。

清理范围：删除仅自身声明的 settings/shops demo 工厂、仅 barrel 导出的 GoodsListPanel/ShopDeskPanel/ShopSyncConfigDialog 及其 demo、无菜单入口的 ShopWipPanel 与 learn/supervise/drill 注册、旧 ShopHomeView 及独占样式；`/shop/home` 保留兼容跳转 `/shop/manage?panel=home`；移除无消费者的同步前端安装器。保留共享同步契约/platform 适配/preload 与主进程 IPC/备份回滚服务及测试、现有 demo 组件、共享 legacy CSS；未核实的页面不扩大清理。文档同步共用本机目录、AI 恢复、审核/显式自动发送和历史交接状态。

知识拆分：`manager-controller.ts` 保留草稿/审核生命周期、跨视图协调与租约交接；`catalog-controller.ts`、`maintenance-controller.ts`、`product-learning-controller.ts` 分别持有目录采集、备份/恢复/清空、商品学习/识图；`useKnowledgeManager()` 返回对象由 Codex 用 TS AST 核对 126 项且顺序一致，页面与文案未改。主进程拆分：`electron/runtime/knowledge-pipeline-assembly.ts`、`knowledge-learning-assembly.ts`、`assist-runtime.ts`、`assist-detail-catalog.ts` 承担装配细节，`local-runtime.ts`/workspace runtime 仍是统一生命周期、审批与资源关闭的唯一所有者。

验证（分阶段，合计 26 文件 229 项，不称为整合后全量通过）：第一批 3 文件 15 项、typecheck、build:desktop、边界检查、diff 检查通过；旧 `/shop/home` 原生检查 1/1 通过，证据 `artifacts/desktop-selected-1794931660094/shop-home.png` 已目视核对；知识 6 文件 72 项；运行时 17 文件 142 项，新增 factory 测试覆盖注册、惰性、限速和详情发布；两处独立只读审查未发现新 P1/P2。改前知识基线 6 文件 80 项仅作为拆分前证据，不叠加为最终回归数。首批曾遇 Windows 临时文件 EBUSY，单 worker 重跑通过；一次漏 `.mjs` 导出声明导致 TS 失败，补 `checkVueSource` 声明后通过。

整合复验：保留 1.0.55 自定义模型 API 后，登录/导航等 4 文件 31 项、typecheck、构建、变更文件 ESLint 与边界检查通过；主进程公开返回方法用 AST 核对为 22 项且顺序不变。1.0.56 原生桌面定向 15/15、知识库主专项 18 项、待学问题 2 项、内嵌学习进度 5 项通过。待学问题原生脚本首次遇到刷新 loading 卸载筛选按钮的时序窗口；核对拆分前相同逻辑并做对照，仅在验收脚本增加按钮已挂载且可交互的有界等待，保留全部原断言，Codex 独立重跑通过，未修改产品逻辑。首次失败及后续日志保存在 artifacts/maintenance-20261118/。

最终验收基线为 1.0.57（beddc49，包含本次 1.0.56 整理及并行 README 更新）：[GitHub 构建 44128396327](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44128396327) 全部通过，包含全量源码/上游检查、完整原生桌面、知识学习、打包及真实打包程序验收。产物已下载到 release/ci-beddc49/，清单版本/提交与三份 SHA256 均匹配；本机同一便携包 8 项验收通过，ASAR 9119 成员、文档解析 8 部分、无私有数据/开发文件，许可原文字节匹配。首次隐藏 capturePage 出现 UnknownVizError，原脚本同包复测通过，未修改图形或产品代码；首次失败记录与复测日志保留。主目录源码已构建并打开，进程与界面均实测 v1.0.57，userData 保持原路径，临时 inspector 已关闭。

收尾时另一任务已合入 1.0.58 开发调试功能（c9a71fa）；其改动保留，其后续验收由对应任务负责，不将本条 1.0.57 结果冒充 1.0.58 验收。完整本轮回执在 artifacts/maintenance-20261118/acceptance.json，打包回执在 artifacts/packaged/report.json。未发布公开 Release、未部署生产、未向真实买家发送；原始 DeepSeek 事件和诊断保留于系统 TEMP/lingtu-maintenance-cleanup-20261117。

## 2026-11-17 进店欢迎开关布局与随机延迟（1.0.52，本机源码）

按用户最新要求，进店欢迎标题右侧只保留一个启用开关（active-text 启用，aria-label 启用本店新会话欢迎，data-no-drag），删除原说明段落和欢迎面板的 RuntimePanel 说明；文字欢迎语下方新增“欢迎延迟 [下限] ～ [上限] 秒随机”，默认 1～3 秒，可保存 1～3600 整数秒有序范围（相等即固定）。欢迎面板移除普通“载入最新配置”，只在版本冲突时显示“重新载入”，草稿保留到用户显式点击；保存仍只有一个“保存配置”，把文字、启用和延迟随同一版本 CAS 原子保存。Enter 提交在入口再次校验范围与冲突，不能靠按钮 disabled 绕过。

文字欢迎仍由 vendor claim/decorate 合并在首次符合条件的 AI 正文中，不拆成独立消息，独立访客及图片/视频规则未改。store-welcome.cjs 只在原严格记录中增加可选 delayMinSeconds/delayMaxSeconds（默认 1/3、同一条原子记录和版本 CAS、旧 v1 迁移补默认），新增 claimEntry 返回实际认领文字与版本；reply-engine 的 decorate 只在欢迎文字确实位于最终正文开头时写入 meta.welcome，候选经原 beforeSend 携带该可选元数据，绝不按任意正文前缀猜测。抽样、等待、取消全部在本工程 TypeScript（electron/welcome-delay.ts、local-runtime.ts）。

统一确认门放行后才进入欢迎延迟；普通回复无 welcome 元数据直接放行。延迟期间复核候选当前性、店铺在线/AI、欢迎启用与版本、本机归档新消息，并以每档≤100ms 同步检查取消；异步网页消息复核沿用既有 hook 超时，取消可能晚于 100ms，但失败关闭不发送。复核通过后把同一检查保留到 worker focus/read 与适配器填写/点击阶段，最终放行前再核对。取消会结束“正在发送”显示并释放 PDD 一次性发送租约；停店、停 AI、人工接管、新消息、欢迎停用/改版、本地服务关闭均不发送。欢迎认领在装饰时已消费，延迟取消不会把本次欢迎重新排队，这是既有 claim 语义，避免重复欢迎；需要重发由用户显式处理。

DTO/快照/草稿/同步边界补齐延迟字段：解析后的快照一定带默认值，类型仍允许旧夹具省略；store-sync 的 welcome businessFields 含延迟并按 1～3 秒解释旧记录，保存命令不携带运行时 enabledAt。

验证：定向 vitest 12 文件 106 项通过（含真实厂商装饰、确认门取消、PDD 租约、同步、Vue 布局/冲突/Enter 校验、异步竞态 2 项）；vendor store-welcome 7/7、reply-engine+managed-backend 82/82、backend-integration 7/7；`npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run check:vendor`（runtime 80/server 94）与 `npm run build` 退出 0。原生仅运行 `LINGTU_DESKTOP_CHECKS=business:welcome-timing-settings`：1/1 通过，报告 `artifacts/desktop-selected-1794926409120/report.json`，截图 `artifacts/desktop/welcome-timing-settings.png`，使用临时 userData、本机模拟店铺和合成文字，没有打开真实店铺或发送消息。未运行全量桌面/上游套件，未打包、部署、提交或推送。

后续：真实拼多多页面仍需用新买家样本核对延迟后实际送达与取消时机；UI 视觉由独立复核确认。版本 1.0.52，package.json 与 package-lock.json 同一批只递增一次。

## 2026-11-17 新店铺复用其他店铺配置（1.0.52，主干整合）

店铺信息助手引导首页新增“复用其他店铺配置”，有其他店铺时显示。允许跨平台选择来源，客服风格、物流与发货、接待、售后四类默认全选；先填入本店草稿供检查修改，最后统一保存。接待仅含文字欢迎及启用状态、本店转人工关键词/继承；不复制商品、平台规则、媒体、凭据、登录或AI状态。来源缺项保留本店值，明确关闭会复制；一次性复制不建立持续关联。复用现有Vue/Element Plus、模型方案和接待业务命令，无新依赖、IPC或存储格式。

DeepSeek独立工作树实现，Codex与独立审查补齐重复导入保留接待草稿、部分成功后禁止撤销、确认后目标再变时拒绝写入、B→C→B乱序请求隔离。合并最新main后相关12文件112项通过；Vue/Electron类型检查、修改范围ESLint/Prettier、构建与隔离原生复用流程验证。补充原生冲突场景先复现确认框被固定向导遮挡，再以此弹窗专用遮罩样式修复；验证弹窗可见可点击、取消保留当前目标值、确认后保存草稿。未运行全量Release验收、未打包发布、未部署生产或向真实买家发送。

截图与报告位于本任务工作树artifacts/desktop及artifacts/reuse；主目录重启验收和云端检查结果以本轮最终交付记录为准。

## 2026-11-17 待学问题处理反馈与历史（1.0.50）

修复标记解决后无反馈、记录仍混在待学列表及无历史入口。默认待处理，新增已解决/已忽略分类与重新打开；中文状态、处理中禁用、成功/失败反馈。标记只记录状态，不生成或发布知识；补充答案仍走草稿审核。按状态在仓储过滤后分页，支持搜索和超过100条，顶栏只计open；末页移除最后项自动回退。旧查询不指定status仍返回全部。更新按ID读取并校验店铺，修复首100项之外跳过校验的边界。无新依赖、IPC或数据库迁移，不改真实业务数据。

复用已有 Vue/controller/run/notice、Zod schema、SQLite 仓储和原生验收脚本。DeepSeek 独立工作树实现，Codex 检查及补充边界修复；只读审查已复核无剩余 P1/P2。相关4文件97项测试、类型检查、改动范围ESLint通过，Windows构建通过。新增 --misses-only 原生流程通过真实preload/IPC/SQLite验收解决反馈、历史、重新打开、忽略及店铺隔离，并保存截图。首次原生运行因渲染求值失败已记录，增加求值错误上下文后复测通过；未称首次成功。验收使用临时账号、合成记录与本机模拟模型，不调用真实付费模型或买家发送。

后续：若需要把待学问题与已发布答案建立关联，应另行定义关系与审核规则；当前处理状态不代表答案已生成。云端检查以对应Actions实际结果为准；未发布Release或部署生产。

## 2026-11-17 自有代码 Apache-2.0 与第三方许可保留（1.0.49）

按用户明确授权，根 LICENSE 使用 Apache-2.0 官方标准原文，自有原创范围见 docs/legal/LICENSE_SCOPE.md；第三方运行时、server 导入及其派生代码仍适用各自 AGPL，不将组合应用宣称为可任意闭源。添加 NOTICE、贡献规则，并同步 README、商业服务模板与桥接来源记录。复用现有 electron-builder 和 @electron/asar，不新增依赖。

验证：独立 worktree 的 Windows 目录打包成功；实际 ASAR 的 Apache/AGPL 关键许可原文与源码逐字节一致，包内私有文件排除及真实应用启动、IPC、8 部分文档解析通过。tools TypeScript、改动脚本 ESLint、vendor 完整性（runtime 80/server 94）、diff 检查通过；只读独立审查无剩余 P1/P2。server/**、vendor/lingtu-runtime/**、bridge.js 未修改。Windows ASAR 提取使用平台规范化路径。未运行本地全量回归，云端状态以对应 Actions 为准；未发布 Release 或部署生产。

后续：保持第三方原声明与来源证据；任何组合分发按实际组件履行许可义务，不能以业务数据隔离替代代码许可。后续引入外部贡献须核实其许可范围。

## 2026-11-17 托管文字/图片分流（1.0.48，生产未部署）

已实现：无显式模型的文字请求按账号/全局默认处理，图片请求自动使用授权且就绪的 Qwen3-VL。新库无试用策略行时默认 100 次，仅允许 deepseek-flash 与 qwen3-vl-plus，文字默认 DeepSeek。该精确双模型策略下 DeepSeek 不可用时文字/免费摘要明确失败，不静默改走视觉模型。显式 model 仍须授权且具备图片能力；缺失视觉路由在预留前拒绝。

已保存策略从旧默认基底解码，不覆盖旧范围、默认模型或账号额度；旧 scope=all 和视觉别名保留原通用回落行为。生产旧服务需另行授权部署，再由管理员保存 selected=[deepseek-flash,qwen3-vl-plus]、default_model=deepseek-flash、calls=100；已有授权次数与期限不会被批量改写。

复用固定 New API/GORM、已有渠道绑定、幂等与扣次账本，不新增依赖或桌面协议。/me 根据实际授权视觉路由提供识图能力，model 仍为文字默认。实际路由模型用于用量与成本，一条图文成功请求仅扣一次；免费摘要、失败及未知结果沿用原计费语义。后台复用试用卡片，说明授权/路由/扣次，并按当前授权范围提示视觉不可用。

验证：独立 3 项验收覆盖文字、纯图、图文、图片学习、重放不重复调用、两模型共享 100 次及第 101 次拒绝；默认/旧策略/路由专项通过。较广两包回归曾发现旧夹具假设，明确旧策略的夹具修正后，全部失败项与独立验收重跑通过（63.175s）；未把之前完整包失败记录称为通过。管理页 28 项、网页类型 1436 文件、改动范围 oxlint、翻译检查 2 项、网页和 Windows 服务端构建通过。MySQL/PostgreSQL、Linux、GitHub CI 以实际后续结果为准，未运行完整桌面检查。

验收在本工作树独立准备树和复制的依赖中执行，不调用真实付费模型、不发送买家消息。worker 曾改写 E:/WuchengBuilds/lingtu-cost-production-20261117 可再生缓存，该缓存不作为本轮证据，所属任务使用前须重新 prepare；正式目录与生产数据未改。

## 2026-11-17 托管模型上下文策略（1.0.44，本机源码）

本轮按“自行托管模型的用户可在服务端配置上下文”实施：管理员在原生管理页编辑全局策略，服务端加密保存隐藏接待提示词并用 revision 防止旧草稿覆盖；已登录桌面端只取得安全投影，既有本机 Key 路径保持原样。托管聊天按服务端当前版本校验用途、学习来源、视觉能力及输出上限，隐藏接待规则只进入上游请求；知识检索先由原有审核/店铺/SKU/有效期规则确定候选，再按服务端顺序和 token 预算放入完整引用。默认学习关闭，审核门和逐条发送确认保留。

已完成策略持久化、管理员接口与管理页、客户端投影、桌面类型化透传、服务端执行和接待知识预算；复用现有 Gin/GORM、原生 React 管理页、Electron 主进程、知识 resolver、tokenkit 与 cl100k 计量，不引入新生产依赖。主线的免费摘要、付费额度与成本记录已经一并保留。合并中修正固定上游计费测试与自有测试重名、空库无需回填旧收据来源，以及本机编排测试期限过紧的问题，未更改固定上游文件。

本版没有接通商品详情页直接采集、自动学习或视频/语音解析，当前商品学习入口仍沿用原有资料/OCR 与人工审核流程。学习模型接口不会自动写知识库；单商品调用上限因缺少可信商品身份仍是预配置，管理页已明确提示。下一阶段需要在平台适配器中取得可证明的详情页文字/图片或视频证据，经授权来源及调用次数控制生成草稿，再在真实页面与人工审核链路验收；不能把服务端允许某类来源等同于已经验证来源真实性。尚未部署生产服务、调用真实付费模型或向真实买家发送消息。实际测试和运行版本见 VALIDATION.md；部署须按 server/AGENTS.md 单独授权。

## 2026-11-17 根目录文档与配置整理（维护性，版本仍 1.0.39）

按用户要求继续整理根目录，不删除源码、运行数据或工作目录，不修改业务功能、版本和依赖，也不执行发布。根文件从 20 个减少到 10 个（若不计 Git 元数据 `.gitattributes`，为 19 个到 9 个）：`LICENSING.md`、`COMMERCIAL_LICENSE.md`、`THIRD_PARTY_NOTICES.md` 移入 `docs/legal/`；三个 TypeScript 项目配置及 `electron-builder.json`、`eslint.config.mjs`、`.prettierrc.json`、`.prettierignore` 移入 `config/`，新文件名为 `tsconfig.*.json`、`electron-builder.json`、`eslint.config.mjs`、`prettier.json`、`prettier.ignore`。保留根 `LICENSE`、`AGENTS.md`、`package.json`、`package-lock.json`、入口页、根 `tsconfig.json` 与 Vite 自动发现配置。

同步更新了 `package.json` 的 `typecheck`、`lint`、`format`、`format:check`、`pack:win`、`dist:win` 命令及 Prettier 包字段，`electron-builder` 白名单改为 `docs/legal/` 路径并保留全部许可与第三方声明；云端桌面构建显式传入 `config/electron-builder.json`。活动文档中的当前路径已更新，历史验证命令与历史日志保留原文。技术栈与依赖未变化，`package-lock.json` 未改。

验证：`npm run typecheck`、`npm run lint`、`npm run format:check`、`npm run build` 均通过；三个 TypeScript 项目在移动前后 `--listFilesOnly` 均为 1475、159、253 个文件且集合一致；`Packager.validateConfig()` 成功加载 `config/electron-builder.json`，`appDir` 仍为仓库根，16 个显式 `files` 条目和 `extraResources` 路径均存在；`prettier.resolveConfig` 返回新位置配置。未运行全量测试、打包发布或真实应用操作。

## 2026-11-17 闲鱼切换买家、上下文时间与店名识别（1.0.27）

针对用户反馈的闲鱼切换人、无法识别上下文、识别不了店铺名字：`xianyuTimestamp` 现解析“昨天/前天 + 时间”“MM-DD HH:MM”“YYYY-MM-DD HH:MM”和“N分钟/小时前”，配合 bridge 的 `isTimeLabel` 补丁，跨天消息不再全部落到当前时间；`sendText` 在切换前、写入后各核对一次当前买家，商家切走后不抢回旧会话也不点击发送；打开店铺后从登录 cookie `tracknick`/`unb` 回填店名和卖家 id，仅在占位名、空名或登录账号变化时更新，换账号会停 AI。桥接补丁和来源记录见 `vendor/xianyu-bridge/PROVENANCE.md`。

用户明确要求“不要查什么实现了，直接提交”，因此本次只提交代码，未执行测试、类型检查或构建验收；下一项必须先跑 `tests/xianyu-adapter.test.ts`、`tests/simulator.test.ts` 和类型检查，再用真实买家新消息验证切换买家与上下文。

## 2026-11-16 闲鱼 AI 接待读取当前打开会话（1.0.26）

用户反馈闲鱼店铺在线、AI 已开启，但页面里的买家消息没有进入 AI 回复。只读核对确认：引擎在运行，`popPending` 只读取有未读红点的会话；当前打开的会话被商家点开后不再保留红点，因此新买家消息永远不会交给 AI。已修改 `electron/xianyu/adapter.ts`：`popPending` 先读取当前打开会话，若最后一条是买家消息且未确认，就和未读会话一起交给引擎；最后一条是我方消息时不重复生成。抽出的 `#activeConversation` 与消息采样共用同一读取口径，通知/系统消息仍按黑名单跳过。自动发送前还读取现有输入框，发现人工未发送草稿时拒绝覆盖。

验证：`tests/xianyu-adapter.test.ts` 14/14 通过，新增“当前打开会话无未读也交给 AI、防止重复认领”“最后一条是我方消息不交给 AI”“输入框已有草稿不覆盖”三项；`npm run typecheck`、`npm run build`、定向 ESLint/Prettier 通过。已重启源码版并确认运行版本 v1.0.26；闲鱼店铺重新打开后 `open/online/authenticated=true`，AI 引擎 `running=true`，发送模式恢复为自动发送。实际运行日志在 23:45:39 出现“会话 x\*\*\*4 消息已过期，跳过”，证明当前打开会话已进入引擎待回复队列；因消息早于引擎 3 分钟时效只归档未回复。没有向真实买家发送测试消息，真实自动回复仍需由新买家消息验收。

边界：超过引擎默认 3 分钟处理时效的旧消息只归档不自动回复；现有 `tbNick_2rqeq`、`浩佳俱乐部` 等旧待回复会话不会被追认，需人工处理或等新消息。未执行安装包发布或生产部署。

## 2026-11-16 取消本机/托管账号工作区隔离（1.0.25）

用户登录托管账号后发现原有本机店铺全部不可见，明确要求“去掉，不要隔离”。已改为本机模式与所有托管账号共用 `local-runtime` 根目录和 `yunduo-local` 平台分区：登录、切换账号、退出和待重启提示都不再切换或遮蔽业务数据；登录只决定托管 AI、团队和计费资格。未登录时启动 AI 会明确提示先登录，店铺数据仍可查看和编辑。旧 `managed-workspaces/<来源>/<账号>/` 目录保留在磁盘但不读取、不自动合并。

验证：

- `npx vitest run tests/managed-controller.test.ts tests/dashboard-panel.test.ts tests/dashboard.test.ts tests/simple-login.test.ts tests/add-shop.test.ts` 5 文件 40 项通过。
- `npm run typecheck` 通过；`npm run build` 通过；改动文件定向 ESLint/Prettier 通过。
- 隐藏 Electron 定向托管检查 3/3 通过：登录前创建店铺、登录和激活后仍保留同一 id；托管训练/设置界面；请求结果不确定不自动重发。
- `node scripts/reporting-isolated-check.mjs` 三阶段通过：账号 B 和进程重启读取同一本机报表，不覆盖账号 A 事件账本；退出后报表保持可见。
- 本机真实资料只读核对：`local-runtime/stores.json` 仍有 4 家店铺（拼多多、2 个本机模拟、闲鱼），数据未删除。已重启源码版并实际查询运行进程：界面版本 v1.0.25，`mode=managed`、`signed_in`、`userId=1`、`restartRequired=false`，店铺列表显示 4 家本机店铺。

未解决问题：旧托管工作区里 1 条空名称拼多多记录没有自动合并到共用目录；如需保留请先只读核对后明确授权迁移，不自动覆盖本机文件。已知取舍：同一台机器上的不同托管账号会看到同一份本机店铺、会话、知识、工单和平台登录态。未执行安装包发布、生产部署或真实买家发送。下一步由用户在日常界面确认登录/切换账号后 4 家店铺持续可见；验收条件是重启、登录、切换账号和退出后店铺及平台登录态不消失，未登录启动 AI 明确提示登录。

## 2026-11-16 闲鱼网页版店铺接入（1.0.24 本机验证）

用户提供本机 `F:\shanhui-app\kb-port` 参考实现并要求接入其中的闲鱼店铺。已新增闲鱼平台支持：`xianyu` 经 `extraPlatforms` 注入固定 vendor 运行时，页面仍由厂商 `ShopWindowManager` 打开 `https://www.goofish.com/im`；本工程新增 `electron/xianyu/bridge-client.ts`（Electron 传输/注入）、`electron/xianyu/adapter.ts`（适配器契约 v2）、`electron/xianyu/index.ts`，原版桥接脚本复制到 `vendor/xianyu-bridge/` 并记录 PROVENANCE。未修改 `vendor/lingtu-runtime` 的哈希清单。

验证：

- 参考工程 `kb-port` 自身 `npm test` 39/39 通过，`node examples/xianyu-mock.mjs` 输出 scan/detail/chat 三段字段齐全。
- 新增 `tests/xianyu-adapter.test.ts` 11 项通过：时间标签换算、待回复判定、认领/确认、同名会话 ambiguous、发送回显与改写保护、登录后自动复查、事件采样去重；Electron 类型检查与定向 ESLint/Prettier 通过。
- `npm run test:desktop` 87/87 通过；添加店铺弹窗断言新增“闲鱼店铺已开通”。
- 添加店铺弹窗补齐闲鱼店名输入：上游只允许拼多多不带 `storeName`，闲鱼必须填写；`tests/add-shop.test.ts` 新增用例，7/7 通过（与适配器合计 18 项）。
- 本机实机：通过业务命令创建 `闲鱼店铺`（id `584251a7-9032-436c-8970-767dc0f98a5d`），内嵌 `goofish.com/im` 加载成功，桥接 v59 注入成功；未登录时健康检查返回“请先在店铺页面登录闲鱼”，用户扫码登录后店铺转为 `online/authenticated=true`。消息监控已记录当前会话消息（日志“收消息”）；直接核对页面 `pendingChats` 返回 `itemCount=9, pending=[]`，3 个未读均属于“通知消息/闲小蜜”黑名单，因此当前没有真实买家待回复。未发送任何买家消息。
- 全量 `npm test` 一次运行 950/951，失败为 `shop-setup-wizard` 默认 5s 超时；单独运行该文件 17/17、该用例 4.36s 通过，已把该用例上限调整为 15s。检查期间工作区还有并发外部改动（版本 1.0.25、托管/看板相关文件），不属于本项范围；并发安装还造成过一次 `ws` 模块瞬时缺文件，复跑后消失。

当前未接入：闲鱼商品清单采集与学习、视频发送、未打开会话的全局消息监听（`drainEvents` 只采样当前打开会话，AI 轮询 `popPending` 时会激活待回复会话）、真实买家发送验收。桥接脚本来源工程标注 `UNLICENSED`，公开发布/对外分发前必须核实授权，见 THIRD_PARTY_NOTICES。自动登录复查与店名输入已写入源码和构建产物；运行中的窗口需重启后加载最新界面。下一步：等真实买家消息到达后核对待回复发现、AI 候选与逐条确认发送；随后再评估闲鱼商品采集/学习。验收条件：店铺保持在线、待回复买家能被发现、候选只经人工批准发送、页面改版/未登录/验证时明确报错。

## 2026-11-16 商品学习、审核与试问实测（去标识记录）

经用户授权，使用一个真实商品及当前配置模型完成单商品学习：6份资料、12张图，17/17步骤成功；观察进度自动更新、loading停止且不跳页。生成15条候选，排除已过期动态内容及未逐条核对项，只审核发布3条可核对的静态知识，重新读取审核版本确认成功。随后真实试问3个已审核事实，均正确回答并显示相应审核知识引用。未发送买家消息。

商品内联进度、依据拒绝后继续处理和单行紧凑展示复用现有Vue/任务管线，不新增依赖或通用IPC。任务仍持久化，计费重试保留明确入口。相关单测、类型、构建和隔离原生界面检查通过；本次实店验证只覆盖该商品的有限事实，不扩大为所有模型输出质量或真实接待验收。

详细业务资料、原始模型结果、商品/店铺标识与截图仅留在本机忽略的 artifacts/，不纳入公开仓库或安装包。发布前将与最新主干整合并另行完成全量及成品验证。

# 当前状态与源码验收

## 工作区交接与集成验收修复（1.0.20）

修复知识库清除/恢复时的刷新竞态：被更新请求淘汰的 refresh 仍可能先 resolve，原界面会过早应用新上下文并被迟到快照清空店铺。现在等待实际目标工作区快照，再于工作区失效监听处理后交接；10 秒有界，窗口关闭取消，跨账号/较新上下文检查保留，成功提示只在交接确认后展示。

同时修复集成验收中的临时店铺串扰、旧模拟入口预期和版本标签断言；合成知识摄取验收显式注入固定 OCR 边界，不将云端缺少语言包冒充实际识别通过。生产默认仍使用 Windows OCR。相关证据与云端状态见 PR #25。

## 本机清除知识库重启兜底（1.0.19）

用户授权“如一定需要重启就直接执行”。仅在确认清除的重建和回滚重建双失败时，由 WorkspaceRuntime 的原生所有者回调 Electron relaunch + graceful quit；复用原资料目录和参数，单次保护，正常清除或成功回滚不整进程重启。保留原确认、自动备份和恢复守卫，不新增渲染/AI重启接口。清除确认框说明必要时自动重启。清除后自动重启改动来自 codex/knowledge-clear-auto-restart（6e08b1d），本轮按用户指令合入主干；托管服务保持已上线的1.0.18。

验证：相关43项测试通过（知识管理29、工作区14），后补回调中立即dispose的重入队列测试后工作区14项再次通过；Electron类型、4个改动文件lint、build通过。隔离Electron真实relaunch验证不同PID、正常退出、同工作目录/参数/userData。审查无阻断项。已打开1.0.19源码，托管signed_in、米配匠店铺保留、AI关闭；未执行用户知识库清除。日志与截图在 artifacts/clear-auto-restart-\*，重启SDK探针仅使用私有临时目录。

下一步仅由用户在实际需要时自行确认清除；自动化验收不操作真实知识数据。合入前定向复验知识管理与工作区共43项通过；不涉及托管后台重新部署。

## 1.0.18 主干整合：多模型范围与人民币成本（2026-11-16）

本批整合 managed-multi-model 99ed200 与 OCR 基线 52989b6。新增每 API 的人民币输入/输出单价、调用接纳价格快照、历史当前价回算标记；管理概览/每日明细/账号汇总/逐次记录显示成本及未计价数量。沿用 New API、Gin/GORM、shopspring/decimal，不新增钱包或扣余额规则。旧配置入口保留价格，模型更换不会沿用不匹配价格。

验证：server:verify 通过（9 个目标 Go 包的 SQLite 回归、原生网页类型、lint、8 文件 41 项测试、翻译、网页及 Linux amd64 构建）；补充价格保存/不检测/换模型清价 UI 后，admin-page 定向 22 项通过。人民币精度、未知/零价、旧接口兼容、三视图一致、接纳后改价保留快照均在回归中验证；复审三项已关闭。未运行 MySQL/PostgreSQL 实库、未重跑无关桌面全量检查。

桌面 npm run build 通过，已从本工作树重启最新 1.0.18 源码；左下版本目视确认，托管账号与米配匠店铺保留、AI 关闭。正式数据未清除，未发起付费模型调用、知识审核或买家发送。日志和截图在忽略的 artifacts/ 与 server/artifacts/。

用户随后明确授权上线，1.0.18（代码 209f7b7）已于 2026-11-16 更新现有托管服务，程序与后台网页同步切换到 /opt/lingtu-kefu/releases/20261116-cny-1.0.18；旧版本保留。先在隔离的生产数据库副本上验证启动及增量迁移，再停服备份并原子切换。账号、渠道密文、配置、额度及 92 条调用原有字段指纹一致；主密钥、环境文件、systemd 与 nginx 配置未变，数据库完整性通过。公共后台 HTML 与发布索引 SHA256 一致，API HTTPS 与重启健康正常。后台已在用户浏览器打开，人民币成本/未计价数量及模型分布可见。备份和回执在服务器 backups/20261116-cny-1.0.18，包含停服最终数据库、密钥和配置；旧静态资产也保留供未刷新标签使用。无需改 DNS 或复制私有后台到静态公网站点。

目前两个 API 均无人民币单价配置，92 次调用保持未计价，金额显示“—”。下一步由管理员依据实际采购填写输入/输出单价，随后核对有明确渠道/实际模型的历史回算及新调用快照。固定单价不含缓存、分时、阶梯或优惠，不等同供应商账单。没有为验收额外发起收费模型请求、改价或扣余额。具体契约见 MANAGED_SERVICE.md；本机非敏感验收截图与部署回执在 artifacts/deploy-cny-1.0.18/。

## 商品图片 OCR 与视觉学习接入（1.0.17）

复用 Windows.Media.Ocr 中文识别器，无新增 OCR 依赖；主进程通过系统 Windows PowerShell 5 调用 WinRT，固定脚本、超时、取消及有界输入输出。商品卡片新增“识别图片文字”预览；按实际图片分块哈希缓存原始识别结果，绑定当前店铺及来源版本。学习将 OCR 作为不可信辅助文字，同时传入实际图片交由视觉模型复核；不以文字模型或 OCR 冒充视觉识图。模型身份变化使旧估算失效，不恢复已清除来源。

真实米配匠 6 件本机 OCR 已完成：51 张不同来源图片、58 条分块记录，其中 40 条有文字、共 5391 字。用户完成后台管理员验证后，账号已实际分配 Qwen3-VL-Plus 动态连接；原始 OCR 仍可能有空格与识别错误，正式学习同时输入原图。58/58 图片分块任务已 succeeded，skipped=0，得到 58 条图片待审核知识，加首批 4 条静态草稿，共 62 条；6 个商品分别 22、3、6、16、12、3 条，尚未审核发布。

托管兼容补丁仅允许受限 PNG 分块（单图 8 MiB、尺寸不超过 1400×1400，总请求 16 MiB，文本结构仍限制 128 KiB）；买家图片链接校验不放宽。服务端按实际获准通道模型识别 Qwen 视觉能力，兼容动态连接别名。用户另行授权后已部署到现有 lingtu-kefu 服务，保留旧 release、数据库和配置备份，切换前后账本指纹一致、密钥及环境不变；公开网页沿用原文件。部署回执位于服务器 backups/20261116-ocr-vision-1.0.13/deployment-result.json。隔离预检首次因工作目录权限失败，修正隔离目录后通过，随后正式切换成功。

实店补齐了桌面模型别名识别、外层 1 MiB 请求限制、完整 JSON 代码块/空数组兼容和图片专用依据模板；批量托管至少间隔 13 秒，服务端真实记录已确认间隔。单次 512 Token 政策保持，提示收紧单条短事实。当前模型输出如漏技术 sourceId，仅绑定本次已验证的单来源；明确错误来源仍拒绝。3 条无有效依据候选未保存，4 个片段仅经 jsonrepair 的受限白名单删除多余结束括号并保留原文；截断或其他无效响应通过明确“重新生成本片段（会计费）”只重做当前片段，已完成结果不重放。未知提交没有自动重试。详情见 KNOWLEDGE_LIBRARY.md 和 DECISIONS.md。

最终定向 9 文件 86 测试通过，Vue/Electron 类型、变更 lint、依赖边界、vendor 完整性及源码构建通过；vendor 上游 232 测试通过，server:verify 原生 Go/前端测试与 Linux 构建通过，精确路径大请求限制回归另行通过。独立复核曾发现限速装配漏转发，已修复并以真实调用间隔验收；最终无未关闭 Critical/Important。实店记录仅存被忽略的 artifacts/catalog-details，不公开商家原图/知识或账号数据。草稿仍需用户逐条检查识别错误、重复问答及实际适用范围；未测试客服正式发送效果、未发布知识或安装包。

已构建并重启 1.0.17 源码。重启后再次读取 58/58 succeeded、62 条待审核、已审核 0，6 个商品均有草稿；逐一读取并解码知识所引用的 47 份 PNG 分块，SHA256 与资产标识一致，来源版本与学习计划一致。原托管账号 signed_in、米配匠店铺保留、AI 仍关闭。界面停在待审核列表，原生截图已目视核对；下一步仅由用户检查原图、去除重复或不适用问答后决定是否审核。真实验收 JSON 与截图位于 artifacts/catalog-details/learning-acceptance.json、learning-reviewed.png。

## 服务端多模型迁移（1.0.17）

后台试用设置支持全部已启用或指定多个模型；账号指定模型仅为默认偏好。配置接口返回允许的可用目录，聊天请求可选模型，范围外拒绝，默认失效稳定回退，同请求ID改模型拒绝冲突。旧策略/旧客户端保持原行为。保留主干计费和接待入口，不带入旧工作区未提交的支付或摘要功能。具体方案与验证见 docs/superpowers/plans/2026-11-16-managed-multi-model.md。桌面仍调用默认模型，未接入托管模型选择；未部署生产。

## 六件详情补采与完成状态修复（1.0.12）

用户要求继续补齐米配匠6件详情、查明待人工确认并打开新版。根因一：merge在商品/全部SKU交叉核对成功后仍固定partial，把可选条形码为空、未OCR混同采集未完成；根因二：DOM仅读取detail_pic，遗漏basic.carousel_gallery轮播主图。现在原料核对成功且全部SKU有编号/价格/库存才complete，图片下载与目录范围仍单独阻止成功；缺失详情显示具体detailNote而不是重复泛化列表范围。轮播/详情图片只读取已核对商品区域，主图声明数量与实际有效图节点不一致、区域缺失/未加载均拒绝完成。采集完成不代表图片文字已识别或答案已审核。复用现有DOM解析、原生被动响应观察、资产与任务续跑，不增加依赖或IPC。

另修复重新采集后商品卡片动态时间误用已删除历史来源的问题，仅统计当前未移除且未被clear标记的动态来源。相关新增失败用例均先RED再GREEN。独立复核指出的图片区域未就绪也可能误完成已加保护，主图/空详情回归通过；详情无完整图片计数声明仍需真实核对，不宣称支持所有未来平台页面变体。

真实米配匠6/6补采完成：原有1件/5件任务均succeeded且error为空，逐商品原始详情status均complete。按ID的主图+详情图来源数量：1015857328755=12、1004116120118=3、970296395898=10、996506864638=19、987906352438=16、982156786329=3，合计63；全部URL对应成功资产，无缺失图片字节。SKU共47个，首件XM-YSP、其余空编码保持真实值。旧取消任务仅保留历史，不重新启动。未调用模型、OCR、学习、发布或买家发送。真实记录仅存本机artifacts/catalog-details/completed-details.json；下一步仅按用户明确要求进行学习/审核。

最终验收：6个定向测试文件85项通过，Electron类型、变更lint、依赖边界、格式和源码构建通过。已重启1.0.12，重新打开米配匠知识库；持久化任务仍均成功，读取并解码全部57份去重后的图片资产成功，6件动态来源均未过期，问答条目仍0。截图artifacts/catalog-details/completed-details.png。独立最终复核无剩余Critical/Important。未打包发布。

## 实店采集验收与重采修复（1.0.11）

用户明确要求采集米配匠在售6件，核对图片、商品ID和商品编码。实测先后创建1件和5件两个任务；后者在首件写入时遇到旧“移除同款”留下的非活跃物理绑定唯一键冲突。按实际失败修复仓储复用：仅已清除或旧同款已移除的非活跃身份可重采；原绑定ID与版本链保留，迁入新同款前隔离旧来源、撤回旧绑定知识，不恢复已审核旧答案。已有clear-marker分支继续保留他店来源，不混用新隔离分支。复用现有SQLite事务、来源版本及资产端口，无新增依赖或IPC。

同时修正详情不完整时的目录商品编码/缩略图落库：目录来源保存实读编码、稳定图片URL和已验证图片附件；同URL临时失败保留已有成功附件，不同URL失败不借旧图。商品卡片显示本店平台编码，兼容原手工共享编码。重复绑定、旧手工答案复活、失败刷新丢图、卡片漏显编码均有先RED后GREEN回归；独立复审提出的两个Important已修复并复核关闭。

真实米配匠6/6已保存，重新加载后仍为6件；ID逐项核对，首件编码XM-YSP，其余五件为空，符合后台暂无编码。6件均有已落库图片，逐张读取缩略图字节并解码成功；SKU数量分别4、4、9、4、22、4。原料采集任务进度为1/1与5/5，均标记needs-confirmation（条形码/详情字段不完整、图片未OCR），没有伪标完整采集，没有调用模型、学习或发布，知识问答与待审核仍为0。验收记录和截图仅保存在本机artifacts/catalog-details/collection-verified.json及collected-products.png，不提交实店数据。下一步如需生成客服答案，应由用户明确开始学习并审核；本轮不继续调用模型。

定向仓储/采集/清除测试48项通过，管理页测试28项通过；变更Electron及Vue类型、lint/格式及源码构建通过。已自动运行1.0.11并打开米配匠知识库供查看，未打包发布。

## 商品选品表格完善（1.0.10）

用户要求选品界面补齐图片、ID与商品编码。目录现从真实PDD列表读取可选编码及缩略图元数据；选品弹窗保留白色皮肤，改成明确列的表格，展示图片、商品名称、商品ID、商品编码。无编码显示暂无编码，未读字段与图片失败分别标记；沿用明确选择、跨页和未知总量限制，不默认勾选采集。

复用现有PDD来源校验/图片下载、SQLite资产缓存与KnowledgeThumbnail可见加载，无新增依赖。新增受目录/店铺/身份绑定的catalog-thumbnail内部动作，图片成功后才注册资产（单张最多2MB）；旧目录/店铺变化或关闭时拒绝晚到结果。仅内存查找映射最多512项，磁盘资产按原保留规则处理，不自动删除。图片解码失败增加可用的空态。详情见KNOWLEDGE_LIBRARY.md。

4个定向测试文件81项通过，覆盖真实DOM解析、来源图片授权、表格选择/空态、缩略图缓存、过期/换店/换目录与MCP回归；Vue/Electron/tools类型、变更lint/格式及边界检查和源码构建通过。独立复审发现的空编码跨行误读ID/SKU已先RED复现，再修复，新增标题误识别反例，复核无剩余Critical/Important。

已用真实米配匠目录验收：6/6商品，6张缩略图均成功加载，第一件真实编码XM-YSP，其余5件后台暂无编码；商品ID逐项独立显示。前后商品知识0、问答0、任务1不变，没有采集详情、学习或发布。真实界面截图及结果保存在本机artifacts/catalog-details，不公开商家资料。版本递增1.0.10，自动打开新版选品界面供查看；未打包发布或操作其他平台。

选品界面最终实测：1280×900 下米配匠 6 行完整可见，6 张图片成功解码，第一件编码 XM-YSP，其余五件暂无编码；表格无纵向滚动，页面无横向溢出。仅读取目录和缩略图，未选择或启动采集。

## 2026-11-15 外部AI服务接口（1.0.9）

用户要求AI快速调用软件服务，并明确选择“查询＋采集＋草稿”。新增10个固定MCP工具：状态、店铺、打开店铺、知识统计、商品/知识/任务查询、读取后台目录、明确选择后采集、保存本店待审核草稿。不暴露通用业务命令、SQL/路径、凭据、模型学习、删除/恢复、发布、开启AI或买家发送。复用原有WorkspaceRuntime、知识仓储、采集范围和版本检查。

采用官方MCP SDK server/client2.4.0，Apache-2.0，Node>=20；client为开发验证依赖。stdio连接器连接主进程受限loopback HTTP，随机端口/令牌、Host/Origin校验和请求/响应上限；令牌仅保存在当前用户资料目录，自动生成的不含令牌mcp-config.json用于接入AI客户端。连接器直接连接本机，不经宿主代理。目录/认证变化拒绝旧结果；采集/草稿requestId去重，编辑保留CAS且不自动审核。接口启动失败不阻断桌面业务。架构、限制和配置见[AI_INTERFACE.md](AI_INTERFACE.md)。安装版asar外连接器与SDK许可证已加入打包配置，本轮未打Release验证无Node机器。

定向3文件41项通过，含真实官方MCP Client→stdio→鉴权HTTP→临时SQLite待审核草稿，以及共享/他店边界、请求去重、注销后晚到结果、Host/Origin/大小/令牌守卫。新增代理子进程验收（NODE_USE_ENV_PROXY=1且代理端口失效）后8项再次通过；连接器仍能本机直连。Vue/Electron/tools类型、变更lint/格式、模块边界、源码构建通过；独立复核无Critical/Important，Node>=20前置条件已在文档明确。

已自动启动1.0.9，并使用自动生成的配置通过标准MCP客户端在真实托管账号只读验收：available=true、signed_in、10个工具，米配匠目录total=6且complete=true。前后知识条目0、商品知识0、任务1均未改变；未启动采集、写真实测试草稿、学习或发送消息。证据在本机artifacts/ai-interface/live-result.json（忽略提交，不公开客户资料）。当前运行不再依赖DevTools端口。未自动修改其他AI宿主配置、公开发布安装包或部署生产服务。

下一项：用户将生成的mcp-config.json加入所用AI客户端后，先调用lingtu_status获取最新workspaceId，再选择店铺执行允许的工具；跨进程结果未知须查询任务，不自动重试写入。

## 2026-11-15 空店商品读取引导（1.0.8）

参考用户提供的闪回空商品截图，在当前店铺尚无商品时显示居中的“还没有商品”面板，提供“从店铺后台读取”和“自己写一件”。清除后沿工作区重绑定回到同一引导；不依赖一次性首次登录标记。使用未筛选summary商品总量判断空店，搜索无结果另行提示。保持白色皮肤。

读取按钮复用现有catalog→选择范围→采集流程，从空搜索条件读取，避免知识库旧搜索过滤后台目录；读取本身不自动采集、调用模型或发布。能力缓存未就绪仍允许用户点击重试，由主进程重新核对当前店铺身份，未登录/平台未支持时如实显示原因；只读、忙碌状态禁止执行。现有平台覆盖范围不扩展，实店目录页面仍按原采集器的能力及登录状态验证。手写按钮复用现有新建商品流程，无新增依赖或IPC。

界面验收发现清除成功后可能残留“账号工作区已改变”旧警告；补充RED/GREEN测试，只在有效新工作区及店铺上下文绑定时清除旧错误，刷新失败仍显示新错误。3个相关测试文件54项通过；真实隐藏Electron18步通过，含清除后返回空库面板、按钮经实际IPC到达平台能力检查且不创建采集/学习任务。Vue/Electron/tools类型、变更lint/格式及边界检查通过，原生截图已目视核对；独立复核无Critical/Important。

本机参考软件的窗口控制工具报kernel assets路径错误，未操作其页面；界面参考仅限用户截图。未采集真实平台商品、清除真实数据或发布安装包。完成后按用户要求自动启动1.0.8源码供查看；实店读取须用户打开对应店铺并完成平台登录，再在空库点击读取确认范围。

## 2026-11-15 托管账号清除后工作区恢复修复（1.0.7）

用户在1.0.6托管模式清除知识库后，主界面账号/店铺显示为空，并提示工作区不可用。实际运行stderr已确认：WorkspaceRuntime在next.start之前读取next.dataDirectory，而托管账号会话需要start→managed.init异步恢复后才允许访问；清除及回滚两次重建都因此失败，包装器停在unavailable空快照。只读核对原stores.json仍有1条店铺记录，清除操作未删除账号和店铺文件。

修复仅调整重建顺序：先校验配置来源，初始化服务并恢复加密会话，再校验当前认证数据目录及配置来源，最后发布新工作区。保留账号鉴权、目录隔离和失败回滚，不通过跳过检查修复。恢复备份入口共用该流程，也一同修正。版本递增1.0.7。

补充初始化前拒绝访问目录的回归测试：restore/clear两例先RED，修复后WorkspaceRuntime12项、知识库清除7项通过。真实隐藏Electron17项通过，新增托管夹具用系统safeStorage加密、合成设备授权及刷新响应，验证两种清除范围均恢复signed_in账号、原店铺与目录，并保持AI关闭；上一版只覆盖本机模式，未覆盖此异步恢复差异。独立复核无Critical/Important，Electron/tools类型、变更lint/格式和源码构建通过。未用真实账号做清除验证。用户实际数据只读核对，失败操作已沿原流程回滚；不得自动重新清除。

下一项：自动打开1.0.7源码，让用户核对原店铺与知识库入口；不修改登录凭据、不替用户再次执行清除。

## 2026-11-15 知识库清除功能（1.0.6）

知识库窗口的“设置”新增清除区域，支持当前店铺/当前账号两种范围，默认当前店铺。预览显示范围与数量，输入完整确认文字后才能执行。主进程绑定当前工作区、库版本、店铺登记和十分钟一次性token，先完整备份并校验，再在受控副本生成清除结果，复用既有WorkspaceRuntime停止服务、替换、重建与失败回滚。备份路径在成功提示中显示，使用“恢复备份”可恢复。

本店范围解除根商品与SKU、撤回私有知识、移除本店任务和待学问题、撤销公共模板本店应用，保留其他店的共享知识、草稿和来源依赖；保留历史与原件。账号范围清除知识表与兼容投影，保留设置和迁移完成标记，防止旧JSON重新迁移。店铺登录、凭据和模型配置不清除。操作将暂停当前账号服务并重建，AI保持启动默认关闭，确认框已说明。清除后的再次采集/导入采用新来源记录，不能覆盖其他店仍使用的旧来源。

复用项目已有SQLite备份/恢复、Zod严格DTO、Electron受信IPC和白色设置界面，无新增依赖。已用临时SQLite验证两种范围、跨范围草稿/审核版、共享来源保护、相同CSV重新导入、备份失败、旧token拒绝与恢复；隐藏Electron真实preload/IPC的16步验证包含两种清除，并已目视核对设置页和确认弹窗。独立复审发现的“跨店来源导致重新导入误跳过”已有RED/GREEN修正，复核已关闭该P2，未发现剩余Critical/Important。最终9个定向测试文件110项通过，Vue/Electron/tools类型、变更文件lint/格式、依赖边界及源码构建通过。只验证本次及直接影响流程；未清除真实账号数据、重启用户软件或发布新安装包。

下一项：用户重启1.0.6源码后查看知识库→设置→清除知识库；实际清除由用户自行预览、确认，确认前不会清除数据。

## 2026-11-15 日检默认关闭与设置保存修复（1.0.5）

用户报告知识库设置保存出现An object could not be cloned，并要求默认关闭每日检查。根因为Vue响应式设置对象直接跨Electron IPC；manager-service现在在传输前通过既有knowledgeRequestSchema校验并构造普通DTO。日检schema默认false，main知识运行时装配时也关闭旧账号保存的启用状态（只读库不写入），每次新会话需明确开启；界面已注明。其他设置值、审核/来源、日检查重记录及手工采集能力保留。

版本递增1.0.5。先复现响应式对象structuredClone失败及旧默认true，再修复；6个定向文件66项通过，Vue/Electron类型、变更源码lint/格式及构建通过。真实隐藏Electron14项通过，其中新增设置表单90→60分钟经实际preload/IPC写入临时SQLite，日检始终关闭。首次新增验收因测试误查不存在的显式submit属性超时，已改为等待实际仓储保存结果后全流程通过。独立只读审查未发现重要问题；未操作真实店铺/模型或当前运行账号数据。当前1.0.4需重启后加载新默认值和修复，公开v1.0.1附件保持原样。

## 2026-11-15 知识库白色皮肤（1.0.4）

按用户要求与白色主工作台统一：知识库背景、商品卡、表单、编辑区、试问结果和审核弹窗改为白/浅灰，深色正文、蓝色选中与主按钮、浅灰边框，原生表单及滚动条使用light色系；缩略图空态和知识库窗口启动背景同步。沿用现有布局和知识库交互，未新增依赖或修改业务逻辑。

源码版本递增1.0.4并同步锁文件。Electron类型、修改源码ESLint、格式及diff检查通过；真实隐藏Electron知识库13项验收通过，截图覆盖列表、编辑/审核、不同宽度和150%缩放，已目视核对列表和审核弹窗。证据在artifacts/knowledge-manager-check/evidence，旧证据另存artifacts/knowledge-theme-before-\*。保留已知Rollup大chunk、Zod注释及Windows网络通知10108基线告警。本轮未执行Release全量打包、操作真实知识或强制刷新当前编辑窗口；当前软件需重启加载1.0.4。

## 2026-11-15 完整归档增量补合（1.0.3）

用户在审计后明确要求由本聊天合入整批归档。以main的0afacf2为基线，三方融合ff15260（父f2193fc）的49文件增量，并保留另一聊天已恢复的步骤/间隔/异常核对和后续知识库、版本标识修正。补齐配置中心账户组及旧客服/充值页脚移除；订单/算力/充值迁到顶部服务端账号区；模型定制归并本店客服风格，自定义提示词与字数限制、整段填写及输入前后核对等已有改动恢复。源码版本递增为1.0.3。

冲突取舍：已有合法间隔（含自定义60秒）不被旧快照迁移覆盖，保留模型异常请求编号及确认门；独立知识库两个入口、审核投影、Windows长路径与备份恢复、发送引用校验和左下角版本显示均保留。没有覆盖原工程另批未提交支付接入，也没有修改v1.0.1公开附件。

验证：13文件140项加发送互斥4项通过；Vue/Electron类型、受影响源码ESLint、格式和前端/桌面构建通过。第一次组合因向导两处实现自动合并重复及Windows临时文件EBUSY失败，去重后单worker重跑通过；随后类型检查补齐托管验收outputDir，lint去除重复store声明。独立只读复审的重要问题已关闭。此为定向源码验证，不冒称新一轮实店、真实模型或Release验收；本次不强制重启当前编辑窗口，保存工作后下次启动加载1.0.3。

## 2026-11-15 左下角版本识别

按用户要求，主工作台和配置中心左下角新增共享版本标识，构建时从package.json注入，不由页面硬编码。本批源码版本递增为1.0.2并同步锁文件；每批交付更新版本的规则已写入AGENTS.md及VERSIONING.md。主侧栏7项测试、Vue类型、变更文件ESLint/格式及源码构建通过，构建产物包含1.0.2。未重启当前窗口，下次启动显示新标识；现有v1.0.1公开附件仍对应原版本。

## 2026-11-15 v1.0.1 已合入并发布

用户明确要求“合入”“打包发布新版本”，商品知识库分支已合入main，最终发布源码为 `4bfdb7a8c17549866519433b2d0897d5e4583540`。正式 [v1.0.1 发布页](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.1)已公开安装程序、ZIP、构建清单和SHA256清单；远程tag及四个附件的GitHub哈希已核对。旧v0.5.1的Latest标记、资产ID、大小及哈希保持原样，新版从明确版本页面手动下载。

同次Windows Actions全绿：120文件853项单元/组件测试、232项上游回归、85/85真实桌面检查、知识库管理13项、资料学习7项、成品7项。下载同一云端ZIP后，本机真实程序的7项隐藏验收再次通过，实际解析扫描PDF、Word图片、Excel多工作表和PNG共8部分；ASAR版本确认为1.0.1。发布阶段另修正了托管未登录初始化、训练商品审核版投影/草稿范围隔离及Windows深目录SQLite打开/备份/恢复问题，均有RED/GREEN与独立复审。

完整证据、源码/构建/下载链接、校验值和验证边界见 [RELEASE_V1.0.1.md](RELEASE_V1.0.1.md)。安装包无签名；实店PDD/CDN、真实模型语义/OCR、实际计费和物理断电仍需各自验收。下一项为用户保存现有草稿后手动安装或运行ZIP，在所选店铺验证两个知识库入口及资料审核流程；本轮不包含生产部署或真实买家发送。

## 知识库合并前的历史记录

2026-11-15 知识库五项重构及最终全分支审查修正已在隔离分支实现，修正代码提交 `2f962c1`（FIX_BASE `3c8a46e`）。I1长问题和全部旧历史键、I2部分采集/日检继续按钮、I3本店编辑及跨店共享来源、I4中断恢复启动保护、M1历史会话归属均有定向证据。7文件71项通过；后续6项补查通过且不重复累计，Vue/桌面类型、局部lint/格式/边界及源码构建通过（保留已有Rollup警告）。详情见 [KNOWLEDGE_ACCEPTANCE.md](KNOWLEDGE_ACCEPTANCE.md)、[KNOWLEDGE_LIBRARY.md](KNOWLEDGE_LIBRARY.md) 与 [KNOWLEDGE_DECISIONS.md](KNOWLEDGE_DECISIONS.md)。完整修正报告在本机 `.superpowers/sdd/2026-11-15-knowledge-library/final-fix-report.md`。针对0601e8f的最终独立复审已完成：I1–I4/M1全部关闭，未发现新增Critical/Important问题。下一项为用户本地验收；非阻断界面细节及外部边界见验收记录最终结论，不是重做Tasks1–5或默认跑全量。旧坏archive仍严格拒绝，需修复live后重新备份；替换中断保持停机，按文档在完整副本上维护恢复。当前未增加原生截图，既有native证据仍为 `e1689e3`。实店PDD/CDN、真实模型/OCR/计费、物理断电和Release仍未验收。未操作真实数据、重启用户应用、推送、合并或发布。

## 2026-11-15 本轮主干合并范围

用户明确要求将当前六步引导分支与最新回复监控/发送修复合入main。包含：六步店铺信息助手、登录后在平台内容区显示引导、售后默认值、主工作台白色配色、默认最大化，以及本页下述拼多多基线等待、左下角简洁回复监控、按店审核/自动发送和输入期间模式撤销。保留其他工作区、分支与历史，不发布Release或部署服务。

源码版已按用户要求在本机重启；已目视核对新版顶部“回复监控”、左下角白色小窗、店铺右键审核/自动发送菜单。真实店铺仍保持审核发送和AI关闭，没有代发买家消息。合并提交为 `a2e050e`，功能树与 `6ac27a3` 完全一致。合并前重新运行69项发送/监控测试和27项引导/规则测试，96项通过；主干上6项发送与监控原生检查通过，报告 `artifacts/desktop-selected-1794683507934/report.json`。

验证限制：额外联合运行3项店铺添加/商品UI检查与上述6项时，首次180秒超时且没有报告，重试仍无结果后仅终止该隔离验收进程；未修改断言或将其计为通过。新增功能的6项原生检查单独运行通过，店铺引导3项原生历史通过记录仍见下文；联合检查的启动/等待不稳定仍待单独排查。本次没有宣称全量或Release验收通过。

## 2026-11-15 发送基线修正、简洁监控与按店发送模式

按最新用户要求补齐：自动弹出的巨大日志窗改为主窗口内左下角 340×300 白色回复监控，showInactive 不抢焦点、非全局置顶，随主窗口移动/隐藏/退出。标题栏“回复监控”手动重开，小窗“高级日志”保留原完整调试界面。新错误也可显示小窗；关闭窗口不批准发送。

店铺右键保留原功能，新增审核/自动发送，默认审核、按当前账号业务目录持久保存。自动仅处理之后新候选，不追认已有待审核回复；同一 ReviewConsole 继续核对店铺、会话、网页基线、过期和一次放行。拼多多的自动授权版本延续至实际逐字输入及最终点击，切审核或审核再切自动撤销旧授权；人工明确发送、已确认原生接待操作不受此授权侧档替代。状态监控已覆盖正常发送日志不会遮掉发送中/成功/失败结果。

根因与修正：原定位成功后立即单次读取网页气泡，加载未完成时把 `known:false` 当成生成前基线，模型生成后必然无法批准。适配器现在最多等待5秒取得该买家的非空、同页面基线，否则在模型调用前停止；仍拒绝页面变化和错买家，不在审批时补采追认旧回复。旧的已失效候选需要恢复本会话AI重新生成。

验证范围：10个相关测试文件69项通过；Vue/桌面TypeScript、受影响代码ESLint、模块边界、git diff --check通过；源码构建通过（保留已有Zod注释和大chunk提示）。隔离原生6/6通过：小窗父子关系、尺寸与左下角位置；私有历史不可读时网页审核可行；自动复核一次发送；输入中切审核零点击；切买家停止；无回显不重试。报告 `artifacts/desktop-selected-1794682527437/report.json`，小窗截图同目录 `reply-monitor.png`。没有修改vendor或新增依赖；未执行全量Release检查、未修改真实店铺模式、未代真实买家发送、未再合main或公开发布。当前真实运行进程未重启，新构建供下次启动加载。

下一步验收：保存手工草稿后重启源码版，确认左下角监控和店铺右键模式；由用户开启所需店铺AI，先审核发送一条新生成回复核对平台回显，再由用户决定是否选择该店自动发送。真实平台气泡兼容性与实际送达仍需该实店流程验证。

## 2026-11-15 默认最大化启动

按用户要求，下次启动主工作台默认最大化（保留系统任务栏、应用导航和还原按钮），在ready-to-show时先maximize再show，避免先出现普通尺寸窗口。只由main的主窗口入口显式启用，辅助栏、日志等工具窗口和离屏验收保留原行为。本轮不重启当前正在使用的软件；已重新构建桌面入口供下次启动加载。

## 2026-11-15 主界面白色配色

按用户参考图，仅工作台配色改白：顶部/左侧/主背景白色，浅灰分隔、灰色文字，蓝色仅保留主要按钮和选中项；移除蓝色渐变、光晕和蓝色阴影。新增`src/styles/workbench-light.css`在旧样式后按workbench-shell局部覆盖，未改DOM、位置、尺寸、原生平台页或配置中心布局。

格式检查与源码构建通过，独立本机浏览器预览已视觉核对。当前真实软件有未保存的引导内容，因此未刷新或重启真实窗口；用户保存后重新启动加载新配色。没有运行不相关业务测试或改写截图基准。

## 2026-11-15 售后默认值

按用户明确要求，未保存过向导规则的店铺预填截图售后默认值：支持换货/退货退款/好评返现/小额补偿均选是，返现1元且带图好评后截图，补偿上限1元且仅限商品破损、质量问题；换货/退款条件按截图文本。只改新草稿，不自动保存或覆盖已有规则，物流和发货默认值不变。用户仍需最后明确保存后才进入本店AI规则，不执行打款。

## 2026-11-15 登录顺序与引导范围修正

按用户纠正：真实平台添加成功后只展示登录页，等待该店铺登录就绪后才自动显示六步引导。拼多多必须online且authenticated=true、无身份错误；页面打开/仅在线/未知认证均不提前显示。切店、切工作区或删除店铺会取消旧等待，完成后不会因普通在线刷新反复弹出；本机模拟店无真实登录，仍可直接引导。手动基础设置可重开已有店铺配置。

引导固定在右侧平台范围（左300px、顶72px），只将右侧背景设inert，不禁用左侧店铺栏/顶部导航；切店和顶部导航会收起或暂停引导。配置页继续入口回到工作台显示引导，不覆盖配置中心侧栏。源码已核对局部范围及左侧返回拼多多登录页，未代用户扫码或创建测试实店。

本轮26项相关测试、类型/局部lint/边界/构建通过；隔离原生3项通过，包含未登录不弹引导、原生登录视图正常呈现，以及引导矩形精确x=300/y=72、左侧/顶部无inert。报告`artifacts/desktop-selected-1794677993069/report.json`。登录后触发使用隔离状态测试，未新建真实店铺完成实店登录验收。仍在六步助手开发分支，未再合main或发布。

## 2026-11-15 六步店铺信息助手

按用户完整截图将基础设置从三步入口弹窗改为六步整页：引导、客服风格、物流、发货、售后、完成摘要。8风格/长度和本地预览、多发货地/快递、指定快递、发货时效/运费险、换货/退货/返现活动/小额补偿及条件字段已接线；最后统一保存后回读摘要，可重开修改。复用已有模型方案，克隆为本店规则，保留原提示词/字数上限与其他店铺；不自动开启AI、采集、付款或发送。商品数来自当前快照，后台学习/预计耗时没有任务证据时不伪造。详情见[设计与限制](SHOP_SETUP_WIZARD.md)。

未保存草稿按当前工作区/店铺临时保留，工作区切换或进程退出清理；保存后清除旧草稿。修复保存期间仍可编辑、全屏页面下拉被遮挡与背景键盘穿透。实际源码窗口已核对首页、风格即时预览、物流下拉和返回首页，未向真实店铺保存测试条款。

验证：5个相关UI/添加店铺/布局/规则适配测试文件36项通过，含真实临时后端文件重建与正式resolve入口；隔离Electron受影响3项通过，类型、局部lint、边界与源码构建通过。外部模型语义效果、全部Release和实际返现补偿未验。原主干Actions43618187863源check通过、桌面63/82，因旧添加全overlay断言连锁失败；本轮修正受影响验收流程并定向复测，原云端结果仍为失败，不冒充已转绿。

本轮在`codex/shop-setup-wizard-20261115`开发，上一轮已合main不等于本轮再次获主干合并。下一项：用户从源码“开始设置”体验整套填写，并按需确认本店实际条款；再决定合入主干及云端全量产物验收。

## 2026-11-15 主干整合

按用户“先合主干”指令整合开发分支`8a012a2`与主干README改版`b760f92`。业务源码无冲突；README保留主干排版并同步当前平台能力/待验收项，.github说明保留。工作区、开发分支、源码测试窗口和业务数据保留，不执行工作区清理、生产部署或公开Release。主干push会触发现有Actions构建；云端结果须与本次源码定向验收分别记录。

## 2026-11-15 店铺侧栏与基础设置

工作台左侧改紧凑店铺行：平台图标、真实名称/连接状态和独立AI开关；右键基础设置、导入知识、店铺设置、店铺后台、关闭，不含AI管理中心。导入知识/店铺设置按用户要求只预留入口并明确提示。基础设置在新增成功后自动显示，可右键重开；连接→知识→接待/训练复用现有页面，配置页保留继续入口，完成/跳过不自动启用AI。关闭沿用断开店铺语义，保留资料。

新增`open-store-backend`复用现有命令/受限窗口，拼多多共用同店分区，抖店明确提示独立登录；模拟和未知平台拒绝。修正登录期间切店的晚到抢页、配置弹窗关闭动画误清引导和底部菜单溢出。详见[设计与实现](SHOP_SIDEBAR_SETUP.md)。

验证范围：6个相关测试文件41项通过；Vue/Electron类型检查、修改文件ESLint/格式、模块边界、源码构建通过。源码窗口已核对紧凑侧栏/五菜单、基础设置→商品知识→继续引导及拼多多真实后台首页；AI保持关闭，未改商品启用状态或向买家发送。新增自动引导在隔离组件测试验证，未向正式资料添加测试店铺。底部菜单回退已配置和测试，实际多店滚动场景未在本机单店资料造数据；抖店实店后台登录仍待验收。没有运行全量Release检查或发布安装包。

下一项：用户继续源码交互测试，确认基础设置内容与侧栏样式；后续按要求接入两个预留按钮，其他历史平台缺口仍以原清单为准。

## 2026-11-15 平台商品详情与SKU

本轮改商家编码为平台只读来源，移除本机设编码入口，保留旧文件；新增详情、属性、图片来源、SKU ID/规格/编码/独立条形码/价格/库存展示，来源快照按账号/店铺隔离原子保存。重新采集不覆盖人工商品正文或启用状态。固定表头及虚拟SKU滚动均与原生数据交叉核对；禁售900009只跳过该项详情并显示部分完成，其他错误仍中断。正式回复与训练共用规格选择上下文，明确商品/规格匹配，歧义和未知规格澄清，停用和跨店隔离，未改变逐条发送确认。

米配匠实店：10商品，9详情，57SKU/57真实ID，1商品因禁售不可编辑而详情受限；条形码源字段全部为空，未代填。A/B实际资料5场景在隔离真实AiClient受控模型链路通过：A款19.90元、B款18.00元、直接编码匹配、未知Z款与未指定规格澄清。该结果证明真实来源和正式请求选规格，不代表外部模型语义评测。真实10商品仍全部停用，未发买家消息，未提交平台商品修改。图片未OCR，平台来源档案尚不随旧CSV或跨店同步导出。下一项可由用户审核后启用商品，并在其选择的模型训练场按需人工试答。

本轮验证范围：12个相关文件118项测试、完整类型、限定ESLint、格式和边界检查、源码构建通过；隔离三进程16场景涵盖平台编码只读、重载筛选、SKU/条形码详情。独立审查发现的无来源商品回退和重复全档解析问题已修复；新窗口原生观察初始化、固定表头和虚拟滚动均经过实店修正后复测。重复实店采集仍为10商品/57SKU，无重复。源资料、摘要和实际来源AI报告在忽略目录artifacts/product-details-acceptance，隔离UI截图在artifacts/parallel-integration。

更新：2026-11-15。本轮源码实现与针对性整合验收已完成；大陆计费服务已按用户明确授权升级，真实平台写入及商户付款仍待实际条件。原主干云端基线不能视为这些新增功能的验收结果。

## 工作区与基线

- 原工程：`E:\~1awucheng\Plastic SCM\AI电商客服软件\client`。本轮独立工作区：`C:\Users\90760\.codex\worktrees\remaining-platform-features\client`，开发分支 `codex/remaining-platform-features-20261114`，基于清理快照 `02c9286`；2026-11-15按用户指令通过`codex/main-integration-20261115`整合至main，保留原开发分支。
- 原 main 基线 `3e159e2` 的 [云端验收](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/43580027916)通过307项测试和82项原生检查。本轮只验证新增及直接影响范围，不默认全量 Release/check。
- Node24.18、npm11.16、Electron43.8.9、Go1.27.3、Bun1.4.4。当前工作区 Electron 已从现有缓存完成标准安装，`npm start` 可构建并启动。
- 复用 `%APPDATA%/yunduo-ui-restored` 及当前已验证账号的独立目录/平台分区，没有复制 Cookie 或迁移账号数据。实店核对期间 AI 保持关闭，未发送、转接、催支付或收费；后续已获明确授权并完成大陆计费服务部署，未公开发布安装包。

## 当前结果

| 功能           | 本轮已经核对                                                                                                                          | 仍需完成或外部条件                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 平台商品学习   | 实店全部商品4页31/31；第二页中断后续读完成，31候选无重复，退出重启后保留                                                              | 审核保存停用包和启用流程用隔离测试；未启用真实知识或调用真实模型训练验收                 |
| 平台历史聊天   | 原生后台双层分页，11月8至14日4页90/90消费者；末页消息198/198。新任务补76候选、去重226条，总候选333                                    | 平台原生日历只开放最近30天，不宣称更早历史可读                                           |
| 平台订单       | 最新源码全新进程首次采集11月1至14日8页141/141；范围/全部状态/整数金额已核对，失败保留旧报告；修复日历动画和页码先变、订单行延迟刷新   | 退款与精确下单/付款时间来源未提供时保持未知；不把实收合计称净营收                        |
| 访客与原生操作 | type41访问来源、原生转接回执、催支付准确条款及逐项批准已接入；真实IPC读到88位买家、3位可转接客服、39个审核视频；发者按cs_uid核对      | 未实际发送、上传、转接或催支付；当前无待付款对象，无真实新访客欢迎样本；客服在线状态未知 |
| 充值界面       | 固定返回工作台/配置中心、原生最大化/还原、最小化/关闭及后台窗口清理均实测成功；新版本账本/订单正常读取，未配置商户提示准确，无Vue异常 | 已用现有签入会话核对读取；购买成功态仍须安全配置商户后验收                               |
| 服务端计费     | 加密配置、版本自检、签名幂等已实现；Windows及Linux隔离HTTP通过，生产billing.2升级成功，旧账本指纹未变                                 | 实际商户未配置，未创建付款；真实支付及外部回调仍未验                                     |
| 拼多多待办     | 新窗口自动设待处理/全部问题/近60天；实店工单0、售后0，与平台总数一致，无需手动改筛选                                                  | 非空商家售后和多页待处理工单仍缺实店样本，不制造业务数据                                 |

已有自定义话术、跨店同步及回滚、尺码/知识候选、团队与持久定时任务的基线整合见 [整合记录](parallel/INTEGRATION.md)。本轮设计、接口与验收矩阵集中在 [REMAINING_FEATURES.md](REMAINING_FEATURES.md)，不需要通读所有历史交接。

## 验证与产物

新增平台能力复用原生页面、既有账号分区、知识服务、调度器及统一确认；服务端复用 Stripe Go v81/GORM，不引入第二套浏览器框架。所有新 IPC 只允许应用主 frame 和当前工作区，平台页没有业务 preload。

代码冻结后统筹最终实跑39个直接相关测试文件290项，全部通过。完整类型检查、变更文件ESLint、依赖边界、格式与构建通过；vendor/server来源清单80/92文件及原生计费3项通过。B独立专项13文件143项与统筹批次有重叠，不重复相加。服务端Go17项、管理页20项、Windows及Linux隔离进程和生产路由检查见计费交接。

三次独立Electron进程通过15项场景检查：真实Vue/preload/IPC、话术编辑/剪贴板/文件导入导出、跨店同步与回滚、重启保存、旧工作区拒绝、定时任务启停、能力不足不发送、旧批准失效。接待独立审查60项及2项定向测试、工单修复独立复核18项通过，未发现明确P0/P1；退出清理、401覆盖、定位互斥、催支付集合/备注问题均已闭环。脱敏实店证据保存于忽略目录 `artifacts/source-feature-acceptance.json`，隔离进程报告在 `artifacts/parallel-integration/`。

计费交接见 [billing-handoff.md](parallel/billing-handoff.md)，部署与回滚要求见 [BILLING_DEPLOYMENT.md](../server/BILLING_DEPLOYMENT.md)。候选 `server/artifacts/billing-repair-20261114.tar.gz` SHA256为 `91d054526f2f1b676a9a0eed3efba8f9f7f0fc6465eb2ecf68e0f1c2157fc442`，不含数据库或凭据。大陆现有服务已升级到2026.11.14-billing.2：版本200/协议2，匿名计费与管理接口401，支付返回页200；已登录客户端GET计费及订单成功，未配置商户时禁用付款。旧版本及服务器内一致性备份保留，部署和回滚详情见服务端记录。商户密钥由用户在后台填写，不在聊天或报告发送。

## 清理记录

原39个过期文件810.11MiB已归档至 `C:\Users\90760\Documents\Codex\workspace-archives\AI客服-20261114-source-validation`；未清理业务资料、凭据或浏览器登录态。精简说明已本地提交为02c9286，没有清空聊天上下文的可调用接口；本文件和实施计划用于接续。

## 内置网页缩放补充验收

工作台新增平台网页缩放75/100/125/150/175/200%，100%标为原始。已在实际拼多多登录页选择200%，二维码明显放大，软件工具栏保持原尺寸；系统放大镜已关闭。复用Electron原生缩放，无新依赖。13项相关测试、完整类型检查及构建通过。该能力仅临时使用，未保存店铺缩放配置。

## 商品知识界面与交互优化

后续实测修正：原采集仅生成问答候选，商品页仍为空；现在在本页直接启动，展示页数/条数/错误，每页核验后新增停用商品，已有商品编号跳过且不覆盖编辑。采集按钮在新增商品知识左侧，移除大标题、说明及当前店铺选择行，返回按钮移至内容区顶栏。重启后首次采集自动建立正常店铺连接。复用现有原生采集、ElementPlus和本地商品服务，无新依赖或vendor改动。5文件49项相关测试、完整类型、限定lint、边界检查和构建通过；隔离三进程16场景通过。真实米配匠重启后直接点击采集成功，平台声明10条、实读1页10条，列表保存10个停用商品；再次采集仍10个，无重复。未启用知识或AI，未发送买家消息或修改平台商品。后续可验收商品编辑与按需启用；平台列表没有的价格/详情不作补造。

本轮按参考图拆出单店商品知识列表，补双搜索、批量编辑/删除、独立商家编码、状态胶囊与分页、编辑及CSV弹窗；修复顶部商品学习和同步他店占位入口，采集页按来源直达并可返回。未保存草稿/跨店晚返回/部分失败与版本冲突保护均保留。7文件44项相关测试、完整类型与限定lint通过；隔离三进程原生验收已证明31条商品跨页搜索、编码真实保存及重载筛选。截图为合成验收资料，不写真实店铺知识。编码暂不进入AI检索、不随旧CSV及跨店同步。实现设计见PRODUCT_KNOWLEDGE.md。

Task4 round1 fixes: same-name material at the selected target revises stable source positions and retires removed/superseded parts; original registration name/type and shared-blob metadata survive parsing and learning. Diagram/visual OCR candidates now carry owned image/page/tile evidence in persisted draft versions and expose the exact image in the review editor. Uncertain recovery refuses cancelled/succeeded jobs. These are source/review contract fixes, not provider semantic-quality acceptance; no real paid model/platform operation or user-window automation was performed. See the appended Task4 report for exact focused checks and remaining limits.

## 2026-11-15 恢复本地向导与回复间隔改动到主干

旧remaining-platform-features工作树已清理且未提交改动未在Git遗留树找到。本轮按同一聊天中原有实现恢复，并适配当前main，保留后续知识库改造。前五步骤可直接点击并保留草稿；完成页仅保存成功开放。店铺卡片补回基础设置入口。回复间隔复用settings公开控件及REPLY_PACING/expectedMs命令，置客服风格页独立明确保存，全局生效；新配置默认1秒，后台最小1秒，已有合法间隔（包括60秒）保留，低于1秒修正为1秒。侧栏删除设置/定时任务并保留快捷回复，旧/settings跳转配置中心，旧高级模型页移除，顶部登录Key配置保留。独立定时任务禁止新增/启用、停用已存任务并取消未执行事项；共享接待事件调度及历史仍保留。

验证：7个相关文件52项测试通过；Vue及Electron类型检查通过，修改源码ESLint通过，前端/桌面构建通过。隔离Electron新位置间隔1→15→1秒、拒绝0和乐观锁冲突、旧路由、侧栏精简2/2通过：artifacts/desktop-selected-1794747929484/report.json。首次桌面检查因主干缺少卡片基础设置入口失败，补回后复测通过。独立审查发现覆盖手动60秒的风险，已改为保留所有已有合法间隔。未运行全量Release检查，未打包/发布，不操作真实买家或调用真实模型。下一步用户在主干源码窗口验收交互。

## 2026-11-15 云端桌面回归修复

288e0d0云端源码检查通过，桌面79/85。首个失败为旧模型配置页面被删除但business夹具仍查找旧输入，造成后续模型上下文/识图三项连锁失败。现自定义回环HTTP夹具走正式save-model-settings命令，登录UI另有独立验收。managed账号截图等待真实弹窗节点，修复顶部账号文字提前出现导致截图节点未挂载的竞态。ModelSourceSettings异常请求核对移入顶部LoginDialog，侧栏异常提示打开该弹窗，保留请求编号与明确勾选门，不恢复旧设置按钮。相关8项单测与10项隔离Electron流程通过，报告artifacts/desktop-selected-1794748472233/report.json。未调用真实模型或操作真实买家。下一步跟踪新提交Actions全流程。

云端c0857b5的源码、完整桌面85项、知识库及打包通过；产物验收仍使用旧settings页面断言失败。package-smoke改为核对旧地址真实跳转、侧栏仅快捷回复及顶部登录入口，保留全部ASAR、隔离IPC、凭证、文档解析和真实应用启动断言。

## 2026-11-16 桌面软件改名

软件显示名统一为“灵兔AI电商客服”，覆盖统一品牌入口、桌面界面、窗口/模拟页标题及安装显示名。内部标识和用户数据路径保持兼容。独立服务端名称、生产部署及安装包发布不在本次范围。验证：app-identity 与 dialog 专项共 3 项通过，安装配置名称及 appId 校验通过。

## 2026-11-16 物流与发货政策合并（1.0.14）

主干 ShopSetupGuide 将物流与发货全部字段合并为一步，助手缩为五步；同步必填校验、导航、进度和草稿恢复位置。复用既有 Vue/Element Plus 表单及 setup-rules 保存服务，无新增依赖或数据格式。相关三个测试文件33项通过，局部 ESLint 和源码构建通过。已重启本工作树桌面端；自动窗口工具返回的窗口信息与实际进程不一致，未据此宣称真实桌面截图验收。未保存真实店铺政策、未发布。下一步可在店铺基础设置核对合并页滚动和五步导航。

## 2026-11-16 接待配置迁入向导（1.0.15）

店铺信息助手新增第四步接待设置，转接人工与进店欢迎复用原 ShopOpsPanel 完整配置，固定向导目标店铺并隐藏店铺选择；导航删除两个子项，保留自动操作/图片识别与旧深链接兼容。原配置独立保存方式及提示保留，未修改发送/审批服务。相关向导、店铺设置及接待规则面板27项测试、局部ESLint、源码构建通过；重启同一主干工作树并保留账号资料。未保存真实业务配置或执行真实转接/欢迎发送；实际桌面视觉待用户核对，未打包发布。下一步验收：基础设置第四步显示两组配置，按原按钮分别保存，配置中心菜单不再出现两子项。

## 2026-11-16 接待配置迁移合入（1.0.16）

物流/发货合并，转人工及进店欢迎完整配置移到向导第四步，原菜单子项移除。草稿按工作区/店铺隔离；保存时锁定导航，工作区失效清锁，仅恢复实际修改字段。独立复审关闭重要问题，七文件59项相关测试、Vue类型与构建通过。已推送main的30764d5，保留远端改名，其他知识库/OCR改动未提交。本机独立Electron迁移验收180秒超时；云端检查为43750985389。最后一次自动重启被审批策略拒绝，当前窗口可能未加载最后的忙碌锁修正。未执行真实转接/欢迎发送、生产部署或公开发布。

30764d5 云端结果：43750985389 的源码类型/格式/单测/上游测试/构建通过；实际Electron新增 business:setup-reception-migration 通过，覆盖两组配置、草稿往返和欢迎配置真实保存回读。完整桌面69/87：首个失败 business:ui-add-store 为店铺数量2!=1，发生在迁移专项之前，另有后续知识/模型/模拟流程失败；不将专项通过扩大为全量通过。报告在本机 artifacts/setup-cloud-verification-30764d5/desktop/report.json，未公开实店数据。

## 2026-11-16 接待入口统一（1.0.22）

店铺列表的转接人工、进店欢迎统一打开该店设置向导的接待设置；旧 panel 链接兼容跳转，取消独立页面注册。删除未使用的 TransferSettings/WelcomeSettings 和演示数据，保留向导内嵌配置及保存逻辑。相关37项测试、修改文件ESLint及构建通过。其他任务的未提交知识库改动未纳入本次提交；未公开发布安装包或部署服务。

## 2026-11-16 商品学习进度单行压缩（1.0.23）

学习进度移到商品已审核/草稿统计右侧，80px细进度条和24px单行布局；长说明与错误放入悬停提示，不确定调用保留展开处理入口。包含商品内联状态所需的组件、按店铺/绑定关联、轮询和操作接线，复用现有pipeline；未纳入模型学习依据校验的独立改动。保留暂停/取消/继续、计费重试及人工审核门。本地知识库39项测试、Vue类型、ESLint、构建通过；隔离Electron专项验证行高/同排位置、运行/完成/失败与轮询，不调用真实模型。公开安装包发布和服务部署未执行。

合并前复审补充：采集资料不完整时，即使处理数量已为1/1也保留继续入口，避免数量达到总数掩盖待补资料；回归覆盖采集及每日检查的1/1与1/2状态。

2026-11-16 成本整合：从 main 22f2270 隔离整合本轮服务端人民币成本和数据库测试改动，保留 main 支付配置、模型范围及图片限制。价格仍使用 cost_rates 单一配置；旧快照仅按其历史价格兼容，缺快照不按现价倒算。新增服务端 GitHub 双数据库回归与 Windows 本地预览产物。用户已授权提交推送 main，CI 通过后更新本机回环服务；不含生产部署。完整验证证据见 server/artifacts 下实际报告。

## 2026-11-16 充值页卡片化（1.0.25，本地）

在 E:/codex-builds/lingtu-recharge-redesign 隔离分支 codex/recharge-card-redesign-20261116 仅调整充值/共享账单展示：蓝白居中布局、剩余额度重点展示、套餐等高卡片、订单区工具栏与状态样式，保留 compact 订单/用量展示。复用现有 Element Plus，不新增依赖，BillingDashboard 业务脚本未变。相关12项测试、Vue类型与组件ESLint通过；隔离Electron截图测量覆盖1280/2560/600宽度、两种compact及错误状态，无横向页面溢出。未创建真实支付订单，未提交推送、未发布或部署。下一步按用户本地验收结果调整。

补充验收：构建成功，独立复审无阻塞问题；已重启至该隔离树的1.0.25构建并打开真实充值页，核对套餐、额度与订单显示。未点击创建支付订单。

## 2026-11-16 接待向导精简（1.0.26，本地）

在同一隔离工作树保留未提交的充值页改动，精简第3步接待展示：两组基础配置常显，全局关键词/平台规则按需展开、持续挂载保留草稿，压缩说明/间距；待处理审批常显，终态历史折叠。错误保持可见、规则校验/冲突自动展开。新增折叠不清草稿/不保存回归，接待向导/规则/逐项批准共37项测试与Vue类型通过。隔离截图脚本被自动审批策略拦截，没有执行该脚本；改用本机实际窗口检查。仅本地修改，不提交推送或发布。

后续：构建、定向ESLint通过，独立复审未发现阻塞回归。已重启并核对工作台显示v1.0.26；本机点击未能可靠进入接待步骤，因此未声称完成该步骤真实桌面截图验收。

## 2026-11-16 回复间隔进一步压缩（1.0.27，本地）

按用户截图移除AI回复间隔h3、载入已保存间隔按钮和底部独立保存说明。标签/输入/保存同排，当前值和全局范围提示紧邻下一行；保存、最少1秒和expectedMs并发检查不变。保留前两批本地充值及接待简化改动，未提交推送。

## 2026-11-16 转人工区块去冗余（1.0.28，本地）

按用户要求移除转接人工可见标题、独立保存说明、关键词命中说明及载入最新配置按钮，保留无障碍区块名称。RuntimePanel仅在有标题/说明/操作槽时渲染页头，其他调用保持原状。欢迎/识图的冲突载入入口保留，关键词编辑、独立保存及平台逐项批准流程未改。保留此前未提交UI改动，不推送或发布。

## 2026-11-16 欢迎媒体区去冗余（1.0.29，本地）

按截图删除接待步骤保存说明，嵌入欢迎区直接展示欢迎媒体0/4及媒体编辑/规则保存；去掉该区高级折叠标题、访客规则标题/刷新、能力说明、启用开关和重复欢迎文字输入。mediaOnly展示属性仅作用于嵌入欢迎区，已有规则文本/开关状态和保存/逐项批准逻辑保持，不删除存储数据或自动启用规则。错误沿用父层展示，草稿回归改为媒体地址往返。此前本地改动保留，未提交发布。

## 2026-11-16 回复间隔单行布局（1.0.30，本地）

回复间隔缩为同排标签、96px小输入、保存按钮及当前值/全局提示。最少1秒/所有店铺范围保留在提示title及原输入校验，无障碍标签保持完整；窄容器自然换行。保存及并发检查逻辑不变，保留此前未提交UI修改。

## 2026-11-16 移除载入接待规则按钮（1.0.31，本地）

移除接待规则操作栏的载入最新接待规则按钮，保存/删除和刷新平台状态保留。仅在真实版本冲突时提供提示内的最新版本重新编辑链接，避免冲突后无恢复入口。保存及批准逻辑不变，前述本地UI改动保留，未提交发布。

## 2026-11-16 接待文案继续精简（1.0.32，本地）

按用户原文去掉转接前核对说明、规则保存批准说明和未取得能力证据提示；页面过滤指定的读取真实平台能力失败提示（父层与规则区均处理），其他错误仍原样显示。未改变后端失败状态、目标校验、能力限制或逐项批准。前述本地UI修改保留，未提交发布。

## 2026-11-16 删除跨店同步页面（1.0.33，本地）

删除StoreSyncView与对应页面测试、sync面板注册/菜单、店铺卡同步他店入口；旧/store-sync跳转店铺列表，panel=sync走统一店铺列表回退。保留同步服务/IPC/契约和历史备份，不执行任何业务资料删除。原生整合验收改为旧路由回退及内部隔离配置同步/回滚契约；未声称已运行整套原生整合检查。保留此前本地UI改动，未提交发布。

## 2026-11-16 本批UI整合交付（1.0.33）

用户已要求合入主干。本批包含充值卡片布局、接待设置按需展开与指定文案/按钮删减、回复间隔单行布局，以及跨店同步页面和可见入口删除（保留服务/备份/旧地址回退）。合并前集中验证10个相关测试文件87项通过，Vue/桌面TypeScript、修改文件ESLint/Prettier及diff检查通过；simple-login现有夹具有router注入警告，断言通过。独立代码复审无阻塞项。充值页多尺寸/compact/错误态完成隔离截图检查，完整向导桌面视觉验收仍未完成；不将局部验证表述为全量桌面通过。未创建真实支付订单、未触发平台发送、未公开发布安装包或部署服务。

## 2026-11-16 店铺 AI 开关记忆（1.0.34，本地）

正常启动与账号重新登录后，按账号及模型来源目录内保存的每店明确开启记录恢复。复用现有原子 JSON 持久化方式及 set-ai 启动门，无新依赖；fresh 平台身份读取必须与记录的店铺和客服身份一致。关闭/全部关闭取消待恢复，退出与临时断线保留选择；知识库清除/恢复重建持续抑制恢复。原审核/自动发送模式不变，不恢复旧批准或候选。缺失或损坏记录默认关闭，从此版开始记住成功且身份完整的开启选择。

相关 6 个测试文件 50 项通过（恢复、发送模式、工作区维护、侧栏与销毁）；Vue/桌面 TypeScript、修改代码 ESLint/Prettier、diff 检查及生产构建通过。独立代码审查未发现重要问题。未执行真实店铺自动恢复、真实模型或买家发送验收；缺少新鲜完整身份能力的平台不会自动恢复。用户已授权提交、推送并合并 main；本次不公开发布安装包或部署服务。

本地已重新构建并启动，实际工作台无障碍版本文本核实为 v1.0.34；保留现有账号资料，未手动开启真实店铺 AI。

## 2026-11-16 日志窗口改进（1.0.35）

新增清除日志、置顶/取消置顶，并将详细日志标题栏改成 Electron 原生拖动。复用项目既有 ReviewConsole、Desktop/IPC、Element Plus 与 Electron，不增加生产依赖。保留待确认/发送中候选、关联请求、活动请求与消息去重，清除不批准或取消发送。

专项单元测试 28/28，通过可信窗口/布尔参数、界面失败状态和清除后不重放旧消息等检查；隔离 Electron 桌面专项 1/1，实际切换窗口置顶、点击清除并用 Windows 鼠标拖动核对坐标。真实发送未执行。本批在当前 recharge-redesign 工作树保留既有 AI 开关记忆改动并集成，未公开发布。后续验收：最新版中打开高级日志，核对右上角按钮及标题栏拖动。

## 2026-11-16 拼多多会话切换修复（1.0.36）

实店只读复现：旧 focusConversation 返回成功而 activeUid 未变。当前平台列表依赖 mousedown，原 hook 只调用 click。仅原定位方法补齐按下/抬起、严格买家 ID 匹配，并在 DOM 和旧 store mutation 路径检查实际 activeUid，未切换时返回失败；发送工具及批准门不变。复用现有 hook，来源、双哈希与最小补丁说明见 vendor/lingtu-runtime/PROVENANCE.md。未新增生产依赖。

修复前两项回归失败；修复后定位、输入与互斥专项通过。真实页面用 v9 原定位接口在两个已有买家间切换，返回 UID 与实际一致，未调用模型或发送消息。尚未等待到新的真实买家消息，不能将既有对话切换当作完整新消息链路验收。下一项：观察 AI 开启后真实新消息是否触发该定位并进入审核。

## 2026-11-16 待审核阻塞新买家修复（1.0.37）

用户再次报告没反应，真实日志发现新消息停在 max_inflight；托管 maxInflight=1 被另一买家待审核 beforeSend 长期占用。修复既有回复引擎，仅等待批准期间释放模型名额，finally 恢复计数，保留 processing 同买家独占、发送确认与退出等待，总保留任务上限 maxInflight+32。来源和双哈希见 vendor PROVENANCE。回复监控已手动重新打开，没有批准或发送真实消息。

修复前新增跨买家单并发用例失败；修复后真实引擎/确认门/消息诊断 31 项通过。首次实店验证仅证明一条消息能生成，未覆盖前条待审核时第二位买家，因此不能作为连续接待完整验收。

## 2026-11-17 知识库工具栏分组（1.0.38，本地）

按用户给出的闪回知识库参考，将9个常显操作收为导入商品、自己写一件、导出、备份4个入口；导入4项、导出2项、备份2项点击展开。通用问答显示导入资料；全库备份/恢复范围与原确认流程保持。复用已锁定Element Plus2.8.8（MIT），不增加依赖、IPC或后端行为。切店、工作区、页签、视图关闭菜单；保留原禁用、审核、导出格式和学习回调。

本批相关2文件47项测试通过（工具栏6、manager41），Vue/桌面TypeScript、相关ESLint/Prettier、diff检查与生产构建通过。独立代码审查无重要问题。实际组件隔离浏览器检查1280/600布局无横向溢出，Enter展开、方向键菜单导航、Esc和切页签关闭、导入/备份展开截图已核对；未执行真实导入、学习、备份或恢复。原native专项选择器同步适配，本批未运行其完整业务验收。

REA识别本机shanhui-app.exe为x86_64 PE，SHA256 310f19a8bda9835112f04b9b5b9613c74b74102cf4d89034bc8d194751cf51cf；静态备份字符串检索在300秒工具时限超时并关闭会话，不据此声称还原第三方菜单源码。交互参考来自用户截图和本机UI树，无第三方代码复制。用户已授权将本次知识库工具栏修改提交、推送并合并main；本次不发布安装包或部署服务。

## 2026-11-17 v1.0.37 已合入主干并公开发布

PR #30 合入 main，源码与 tag 为 925dc2ed4c425aff616cd62bda93056337254ec3。Release 提供 Windows x64 NSIS、ZIP、源码清单与 SHA256；主干云端完整检查和 88/88 桌面验收、知识专项、打包启动通过，本机下载校验与隔离成品复验通过。完整范围、一次本机置顶断言差异及专项复验结果、实店验收边界见 [RELEASE_V1.0.37.md](RELEASE_V1.0.37.md)。保留旧附件与 latest 通道，不包含服务端部署或真实买家发送。

## 2026-11-17 导入学习分离与当前店铺备份（1.0.39，本地）

四个常显入口保留；导入只收平台商品、归档聊天、资料文件。学习通用资料移到通用问答内容区，无资料时提示先导入，不进入估算；非空资料仍走原估算、明确确认及审核。导出/备份菜单标当前店名，工具栏导出不受当前单商品详情收窄，文件名含店名并过滤非法字符。旧全库备份及恢复在设置高级区保留。

真正新增store备份/恢复范围：SQLite一致快照经本店适用内容投影、必要来源/附件闭包与hash校验；剥离非本店草稿、审核版本及无关元信息，避免借恢复扩大批准。恢复共享内容为本店隔离身份，不改写其他店私有记录或其解析内容；重复恢复不积累有效重复问答。完整原件可能包含其他商品行，预览披露。外店证据身份缺失/变化时拒绝恢复；任务、待学问题不从store包恢复。新本店入口只接受同店store包，旧full/family保留高级路径。预览绑定账号、店铺、租约、上下文、数据库版本与备份指纹，切店/上下文变化失效，确认前重检目标。恢复继续走工作区停写、暂存、恢复意图及回滚，维护重建不自动开启AI。

按用户本轮新分工由本机官方DeepSeek Harness继续实现，Codex监督与独立验收。原会话session-d5957104-44a7-40cf-95f0-b7173505eeed首轮及三次明确续单均退出0且final.reason.kind=completed；事件/诊断在ignored artifacts/deepseek-store-scope-20261117。未复制凭据或业务资料。

Codex独立验证9个相关测试文件共122项通过（后端68、manager47、toolbar7）；Vue/桌面TypeScript、修改文件ESLint/Prettier、diff检查及生产构建通过。独立代码复审无剩余重要阻塞。隔离浏览器实际manager DOM验证四入口、店名范围、本店备份/恢复菜单、独立学习及空资料不显示估算；Ego截图两次captureScreenshot超时，未宣称新版本截图验收通过。原native harness高级恢复选择器已适配，但未运行其完整流程。源码已重启，实际工作台版本文本核实v1.0.39。未执行真实店铺导入、付费学习、备份恢复或买家发送；未提交推送、发布安装包或部署服务。

## 2026-11-17 知识库顶部去冗余与按需全选（1.0.40，本地）

按截图移除标题副说明、工具栏原料说明和批量栏重复店铺/筛选统计；已有选择才渲染批量栏，保留已选计数、全选本页、当前筛选全选和审核，取消最后一项后收起。商品及问答条目自身复选框保留，真实错误/通知/只读错误及能力禁用不变。此前未提交单店备份改动保留，不改后端。

本机DeepSeek session-905ca29a-e580-41ad-93e7-6cff99e50543正常退出0且final.reason.kind=completed。先加回归观察2失败/47通过，实现后Codex独立运行49/49通过，Vue类型检查、相关ESLint/Prettier、生产构建及diff检查通过。独立代码复审无具体阻塞。仅验证本批影响界面与交互，未运行全量或真实业务操作。源码已重启，实际工作台版本文本核实为v1.0.40；未提交推送。

## 2026-11-17 客服接管关键词（1.0.41，本地）

在店铺向导接待设置transfer区增加紧凑独立“客服接管关键词”，每行一个、全局应用当前工作区所有店，默认空；客服已发文本命中后仅暂停对应买家会话。复用原ReplyEngine manualReplyKeywords/D-07、自发去重和显式恢复，不改买家handoff词，不新增第二套引擎。自有主进程helper和vendor最小save-config分支规范化/校验关键词、CAS预期旧值，只更新manual字段。来源与实际hash已同步，未引入依赖或IPC通道。保存不启用AI、不发送消息。

草稿带load时CAS基线，外部修改后旧草稿拒绝覆盖并按需载入本字段最新值；提交时捕获文本，保存等待期间的新输入保留dirty，workspace/store/view和generation阻止迟到回填。DeepSeek官方headless首轮及review续单均exit0、final.reason.kind=completed，事件在ignored artifacts/deepseek-manual-keywords-20261117；Codex独立检查实际文件并运行4个相关文件51项通过（manual15、wizard26、contract3、reviewengine7），Vue/桌面TypeScript、相关ESLint/Prettier、check:vendor、diff检查和生产构建通过。独立复审两项P2并发/草稿问题已修，无剩余具体阻塞。

测试含配置重启/账号目录隔离、清空、CAS、只改manual、动态worker读取、seller命中仅本uid、buyer同词不触发此规则、自发回环、生成中及待批准取消和显式恢复。没有登录实店发送关键词的真实验收，没有替用户设置任何关键词或批准消息；完整原生视觉验收未执行。此前知识库未提交改动保留；本批未提交推送或发布。

## 2026-11-17 接待全局关键词与规则常驻展开（1.0.42，本地）

按截图移除店铺设置向导接待区“全局人工关键词”“平台接待规则与能力”两处details/summary折叠，改为常驻展开的简洁标题区块，不再显示折叠箭头。保存、草稿缓存、平台规则编辑/刷新/逐项批准与操作审批不变；仅删去只服务折叠的rulesExpanded状态及alert展开绑定，历史平台操作折叠保留。复用现有组件，未引入依赖。

验证：3个相关测试文件38项通过（wizard27、rules6、approval5；更新原默认折叠断言，新增标题常驻及历史折叠断言）；vue-tsc --noEmit、改动文件ESLint与Prettier检查通过。仅验证本批影响界面与交互，未运行全量检查、未打包、未重启源码。此前知识库与客服接管关键词未提交改动保留；未提交推送，未改动真实配置或消息。

## 2026-11-17 合入 origin/main 的版本记录说明（统一 1.0.42）

本文件在合入 origin/main 时两侧都在 2026-11-17 追加了记录，且并行开发期间 1.0.39/1.0.40 被两条线分别用于不同改动：本分支线 1.0.39 为导入/学习分离与单店备份、1.0.40 为知识库顶部去冗余，主干线 1.0.39 为闲鱼接入与共用本机工作区整合（同期并行实例曾运行 1.0.40，主干另有根目录文档/配置整理，记录在上方“版本仍 1.0.39”维护性条目）。以上本分支线与以下主干线记录均按原文完整保留、不改写彼此内容，仅在此说明来源；合入后 package.json/package-lock.json 统一为 1.0.42。真实店铺验证、发布与服务端部署边界仍以各条目自身记录为准。

## 2026-11-17 闲鱼与共用本机工作区分支整合（1.0.39，主干线）

用户明确要求将 codex/remove-isolation-xianyu-fixes-20261117 合入主干。以 main 的 1.0.37 发布基线整合旧分支两项提交，保留 AI 状态记忆、日志清除/置顶/原生拖动和审核等待不阻塞其他买家。运行时冲突同时保留托管 AI 登录校验与清除日志命令，版本不回退到分支的 1.0.27。

复用分支既有闲鱼适配器、用户提供的 kb-port 桥、Vue/Electron 和原确认门，不引入新生产依赖。用户于2026-11-17确认桥接代码为其拥有并允许公开分发，来源与副本边界见 vendor/xianyu-bridge/PROVENANCE.md。审查发现的取消回调、错误补点、历史未知与旧回显误判已补回归；后续页面保护由本机 DeepSeek 实现，Codex 独立复核和验证。只整合主干，不额外发布 Release 或执行真实买家发送。

本机 DeepSeek 同一官方 headless 会话三轮均返回退出码0及 final.reason.kind=completed。Codex 独立复跑15文件173项通过，复审另独立复跑闲鱼3文件53项通过；Electron/Vue类型、变更范围ESLint、模块边界检查通过。桥脚本当前SHA256与字节数已独立匹配来源说明。未执行真实闲鱼发送；新主干工具栏合入后的最终验证继续由整合检查执行。

最终整合补充：主干新工具栏把两个导入入口移入菜单，首次云端源码/桌面检查通过，但资料学习专项仍查找旧常驻按钮而失败。DeepSeek原会话第4轮仅调整 knowledge-ingestion-check 的实际菜单点击步骤，退出码0/final completed；Codex独立重跑 verify-knowledge-ingestion.mjs，7项真实Electron隔离场景通过，保留原导入、学习、模型调用和批量审核断言。未修改产品界面、降低断言或执行真实模型/买家请求。

2026-11-17 整合已完成：PR #32 合入 main，代码合并提交 e1d68becb469c3ff38ff0bf2c481a87533cb2eb1，源码版本1.0.39。已核对原分支 bc42b59/99fd65e 为主干祖先，且保留主干1.0.38工具栏。云端重跑43932783776的完整源码检查、Electron桌面和知识库专项均通过；现有CI后续打包步骤继续运行，本次没有创建或发布Release。运行实例经本机受限状态接口核对已为并行任务的1.0.40，因此未降级或覆盖该实例；没有变更实际店铺配置或发送真实消息。

## 2026-11-17 分支与 PR 整理

已核对全部远端分支与PR：29条PR记录中25条已合并、4条已关闭，无开放PR；15个远端工作分支均为主干祖先且无独立提交。清理15个已合并远端分支和22个已合并闲置本地分支，远端仅保留main；本机main已快进到远端。删除远端时使用原子推送和逐分支确切SHA租约，防止覆盖并行新提交。

保留5个仍绑定工作区的本地分支、所有未提交改动、2份stash，以及历史分离HEAD与快照。仅清理1个失效工作区登记，没有删除其目录或其他工作区文件。旧架构中未进入当前主干的历史独立提交已保留，不盲目合并回现行架构。完整引用清单、审计结果与已验证Git bundle备份保存在本机独立归档目录，本次没有上传这些备份。

本次为Git元数据维护，无产品代码、版本或Release变更。核对当前主干代码e1d68be对应云端构建43933961142成功；未触碰正在运行的1.0.40开发实例和店铺数据。

## 2026-11-17 知识库与接待设置合入验收（1.0.42）

用户授权提交推送并合入 main。功能提交14b7f7d在最新主干ed7133c上整合，保留闲鱼、共用本机工作区、计费及配置整理；版本/交接文档冲突保留两侧记录并统一1.0.42。独立复审未发现重要集成问题。合并后15个相关测试文件212项通过，typecheck、check:vendor、构建通过；未运行全量桌面检查、实店发送、安装包发布或生产部署。上批取消折叠源码曾重启，本次整合后再次构建；窗口读取工具未获准访问Electron，因此不把重启指令等同完整视觉验收。

## 2026-11-17 本地遗漏改动整合（1.0.45）

以a4f4090为基线保留主线新版功能，补齐辅助窗定向导航、Logo/ICO、微信/支付宝支付客户端、免扣内部摘要、拼多多goodsId透传和桌面诊断；Stripe重开、未知创建、摘要记录数量/请求ID及浮窗就绪顺序均经失败复现后回归。20个专项Vitest文件132项、直接相关运行时101项、类型/修改范围lint/边界/来源/构建及6项隔离桌面检查通过。详细范围、备份和未验收项见[本地整合记录](LOCAL_MERGE_20261117.md)。保留AGPL；未部署生产、发布Release或操作真实买家。

## 2026-11-17 店铺向导复用其他店铺配置（1.0.49，本地 worktree）

按已批准方案 `docs/superpowers/plans/2026-11-17-shop-setup-reuse.md` 在独立 worktree `codex/shop-setup-reuse-20261117` 完成引导首页“复用其他店铺配置”。仅在当前工作区存在其他店铺时显示；弹窗四类默认全选（客服风格、物流与发货政策、接待设置、售后政策），允许跨平台并显示核对提醒、来源名称/平台、各类缺项提示和已有草稿的明确替换确认；取消不改草稿。一次性复制到本店草稿，不建立关联、不修改来源店铺、不复制凭据/商品/平台账号/媒体/平台规则/AI 开关，也不执行平台动作。

实现：新增 `shops/setup-reuse.ts`（四类选择、字段映射、缺项保留、显式 false/空欢迎记录、继承显式状态和替换判定）与 `reception/setup.ts`（typed 接待草稿、目标欢迎版本/转人工基线、只读来源合并、逐项保存回读）；`setup-rules.readSource` 只读来源且不改目标保存基线，向导用独立实例读取来源。`setup-store` 以工作区/目标店/来源店/弹窗租约协调读取、应用、撤销、关闭重开保留和工作区切换清空；来源/目标移除与迟到响应不落入其他店。复用模式最终保存先预检目标欢迎版本与转人工基线，再按既有命令克隆本店策略方案、保存欢迎语（使用目标版本）与转人工，政策/欢迎/转人工逐项记录成功/失败；部分失败保留草稿并仅重试未完成项，完全成功才显示完成，后续编辑取消对应成功标记；冲突提供用户显式“以最新接待配置为基线重试”。`ShopOpsPanel` 通过 `deferredSave`/`setupDraft`（公开入口 typed 契约）延后接待保存、隐藏独立写入并显示待保存提示，编辑经 `update:welcome`/`update:handoff` 上送；全局关键词、客服接管关键词、平台规则与逐项批准不变，非复用路径行为不变。

独立复审补充五个边界并已回归：重复导入未勾选接待时保留已编辑未保存的接待草稿、统一保存状态与冲突基线；来源本次缺少欢迎记录时保留既有欢迎草稿与基线；保存进行中不能撤销复用；任一项目开始写入后不再允许撤销，避免界面与已保存数据分叉；来源 B→C→B 乱序读取只接收最后一次选择的响应。

验证：新增/更新 6 个测试文件，相关 12 个文件 101 项通过（shop-setup-reuse 6、reception-setup 9、reuse-wizard 13、独立复审边界 5、setup-rules 14、shop-ops-panel 2、shop-setup-wizard 27、shop-setup 8、reception-rules 6、operation-approval 5、configuration-navigation 4、reply-pacing 2）。`vue-tsc --noEmit`、`tsc -p config/tsconfig.electron.json --noEmit`、修改文件 ESLint/Prettier、`npm run build` 通过。新增隔离桌面场景 `business:shop-setup-reuse` 实际运行 1/1 通过，覆盖来源选择→导入（四类全选、跨平台提醒）→检查（风格/欢迎语/延后保存提示）→编辑欢迎→统一保存→回读（欢迎版本 2、转人工恢复继承）、来源店欢迎/转人工/规则不变、AI 未开启；报告见 `artifacts/desktop-selected-1794925509693/report.json`。未运行全量 `npm run check`/`npm run test:desktop`，未打包、发布或部署。

限制/未验证：真实平台店铺与真实模型未参与本批验收；未替用户保存任何真实店铺配置或发送消息；未执行安装包/Release。按任务约定未修改 package.json/lock 版本（Codex 整合时统一递增一次），未提交、推送或合并。

## 2026-11-17 Windows 任务栏圆形图标与身份（1.0.47，本地）

用户报告安装版不显示品牌图标、源码运行图标为方形。诊断证据：旧 `public/lingtu-ai.ico` 七个尺寸 alpha 全为255，四角为白色实心；本机安装目录实际为1.0.24，app.asar 无 dist/lingtu-ai.ico，EXE 为 Electron 43.8.9 默认资源，故安装版问题来自旧包；1.0.45 便携版 EXE 已含品牌 ICO 但同样是不透明方形。`electron:dev` 只执行 build:desktop 后直接运行 Vite，dist 缺失时 windows.ts 仍只指向 dist，导致窗口回退默认图标；打包窗口显式设置与 NSIS 快捷方式一致的桌面 AUMID，以稳定任务栏分组。

修复：用现有 Pillow 从 `src/assets/lingtu-ai-icon.png` 生成圆形透明七尺寸 ICO，完整品牌内容内缩86%半径避免裁切；windows.ts 源码读 public、打包读 app.asar/dist；打包应用在窗口前设置 builder appId 对应的 AppUserModelID（源码调试不设置，避免归到本机旧安装快捷方式）；保留 builder signExecutable:false 和现有图标配置。新增 ICO 尺寸/路径/AUMID 与 builder appId 一致性回归，透明度复用 Pillow 生成脚本核对。

验证：Codex 独立复验 3 个文件9项测试、Electron TypeScript、修改范围 ESLint 和主目录 npm run build 通过；Pillow --check 七尺寸均四角 alpha=0、中心 alpha=255。已重新打开主目录源码，窗口显示v1.0.47。另用已安装 Electron 生成本机 --dir 解包测试产物（非Release），退出码0；已从EXE提取7个透明圆形尺寸；产品名与1.0.47.0版本元数据正确，asar/public图标逐字节一致，EXE提取图标各尺寸RGBA像素一致（ICO容器头重建后字节不同）。未制作或公开发布安装器，旧安装目录保留原样。测试不自写PNG解码器，透明度复用Pillow检查。

## 2026-11-17 同一买家随机回复节奏（1.0.49，本地）

按用户最终要求完成：基础设置“客服风格”页回复间隔保留原卡片与保存按钮，改为下拉四项——1～3 秒随机（默认）、2～3 秒随机、自定义随机范围（选中才显示起止整数秒输入）、固定 1 秒。范围校验 1≤min≤max≤3600，随机结果至少 1 秒；只作用于同一买家连续回复的排队节奏，不是模型生成耗时承诺。界面显示真实“当前：…·全局生效”，脏草稿标“未保存”，CAS 冲突保留草稿并提供“重新载入已保存设置”，普通快照刷新不丢草稿；说明“模型生成和审核耗时另计”，窄屏按组换行不溢出。

实现：`electron/reply-pacing.ts` 的 `ReplyPacingStore` 独立保存本机业务目录 `reply-pacing.json`（版本 1，原子写入 0600）；`createUidIntervalResolver` 在自有 TypeScript 抽样并按“店铺+买家+上次发送时间+模式/范围指纹”缓存，保存后指纹变化使当前等待立即重算，同一等待只抽一次。`electron/local-runtime.ts` 在快照叠加 `config.reply.pacing`、拦截 REPLY_PACING 保存（CAS 必填）并把 resolver 注入厂商；`electron/message-diagnostics.ts` 读取引擎本次已确定的间隔。厂商仅两处最小补丁：ReplyEngine 接收并转发 resolver 到每个 StoreWorker（Worker 不缓存业务节奏，注入时不再叠加旧 0.5～2 秒发送抖动，异常退 1 秒下限），未注入时每次动态读取 `perUidMinIntervalMs` 并保留原抖动；backend.cjs 只透传该可选函数。双哈希与 PROVENANCE 已更新。

迁移与错误边界：首次没有 `reply-pacing.json` 的旧账号（含旧 60 秒或其他固定值）迁移为 1～3 秒随机并记录迁移来源；旧值继续留在 `config.json` 的 `perUidMinIntervalMs` 供审计/回退，保存新模式不改写它，已有新配置不会被启动流程覆盖。坏 JSON、反序/越界配置、首次迁移写失败都会明确报错并保留原文件，不静默回默认。未改动店铺、账号、Key、AI 开启状态、旧批准或发送审批。

验证（均为本机实际执行）：Vitest 7 个相关文件 60 项通过（含审查者新增 `tests/reply-pacing-factory.test.ts` 7 项真实工厂链路）；相关上游 89 项通过；`npm run typecheck`、变更文件 ESLint/Prettier、`npm run check:vendor`、`npm run build` 通过；`LINGTU_DESKTOP_CHECKS=business:reply-pacing-settings npm run test:desktop` 1/1 通过并查看截图。未运行全量 `npm run check`、全量桌面检查、真实买家发送、安装包发布或生产部署；未提交推送。未重启/打开真实资料实例：本轮为独立 worktree 的源码修改与隔离桌面验收，是否切换运行实例由整合方按版本规则决定（运行中的实例仍显示其原构建版本）。

整合方补充（1.0.51）：合并 de3cd79 主线，保留知识库反馈与许可更新；8 文件 90 项专项测试、typecheck、build、原生节奏专项 1/1 通过。提交入口额外校验非法范围，防止回车绕过禁用按钮，回归已验证。最终集成及本机运行验收记录随后补充。

最终本机验收（1.0.51）：已快进合入并推送 main（功能与整合提交 7d4ba10），主目录构建成功。重启前备份本机节奏相关配置；旧实例只剩知识库窗口，关闭知识库刷新草稿后仍保留无窗口进程，按准确主进程路径停止本项目进程，再从主目录启动新版，未处理其他 Electron 软件。原账号 Root User 与两家店铺仍在，实际窗口和设置页显示 v1.0.51，米配匠基础设置的客服风格页当前显示 1～3 秒随机·全局生效，下拉可读取四个准确选项。本机 reply-pacing.json 为 random-1-3，旧1000ms保留迁移记录。未修改实店 AI 开关或执行真实买家发送；未公开发布新版安装器。云端构建运行号 44098904369，结果以实际 Actions 状态为准。

云端及产物验收：Actions 44098904369 全部成功（源码完整 check、实际桌面、知识库/学习、NSIS/ZIP 打包、包内检查及打包程序启动）。Windows 产物下载到 E:/codex-builds/lingtu-cloud-1.0.51-44098904369，EXE/ZIP/清单的 SHA256 全部匹配。下载便携包在本机独立临时资料目录执行现有 test:packaged，退出码0且status=passed（ASAR运行时/许可/隐私排除、真实preload/IPC、版本和文档解析），未安装或替换日常安装目录，未发布新版Release。主目录当前运行的源码仍为1.0.51。

## 2026-11-17 欢迎延迟主干整合（1.0.53）

保留 d11557c 的新店铺复用及冲突确认修复，欢迎设置整合版本为1.0.53。接待复用的读取、草稿编辑、复制、统一保存与回读现包含欢迎随机延迟；目标版本CAS不变。仅修改时间也会标记未保存；清空或非法范围在任何政策写入前拦截。冲突确认展示当前与拟覆盖的时间范围。普通欢迎页移除常驻载入按钮与说明，开关在标题右侧，默认1～3秒随机。

合并复验：18个直接相关Vitest文件158项通过；清空输入与统一保存的后续定向2文件6项通过，另有异步最终复核/最终发送guard两项先红后绿。Typecheck、lint、format:check、check:vendor通过；本轮没有真实买家发送、生产部署或新版Release发布。原生及本机运行验收记录随后补充。

整合原生复验：business:shop-setup-reuse 与 business:welcome-timing-settings 2/2通过（退出0，artifacts/desktop-selected-1794927165859）。最终1.0.53构建通过；未安装或改写现有安装目录。

1.0.53 本机运行验收：主目录构建、合入与推送完成（aee8da7）。已在原 yunduo-ui-restored/local-runtime 下备份欢迎/店铺/配置后重启；原实例最小化且窗口输入工具不可用，精确核对本项目进程路径后仅重启本项目。Node REPL 连接失效，使用可用的原生 CUA 入口读取并展开新版；实际版本v1.0.53、Root User、两家店铺仍在。进入米配匠进店欢迎卡片目视确认标题右侧开关、1～3秒范围、单一保存按钮、无普通载入及旧说明，范围在1440宽窗口成组且未溢出；未修改文字、开关或时间，重启前后保存的欢迎文字/启用状态一致，没有真实发送。

云端 Actions 44108136749 全部成功：完整check、原生桌面、知识库/学习、EXE/ZIP与打包程序启动检查通过。新版未发布Release，安装目录未替换。

本机产物验收完成：EXE、ZIP、RELEASE-MANIFEST的SHA256与云端清单一致，保存在E:/codex-builds/lingtu-cloud-1.0.53-44108136749。下载出现网络停顿，复用本机既有代理与curl重试；已存在的同源产物未覆盖，直接进行完整哈希核对。便携包在独立临时资料目录执行现有test:packaged，退出0且status=passed，包含ASAR运行时/许可/私有文件排除、真实窗口/preload/IPC、实际版本及文档解析检查。用户日常安装目录未改，当前源码版已打开欢迎设置卡片。

## 2026-11-17 GitHub 首页生态互链（1.0.54）

基于 1.0.53 主线，仅在 README 加入灵兔拆包智录、采购订单导出与本项目的套件介绍和互链。按仓库规则同步递增 package.json 和 package-lock.json；未修改业务代码。用户已明确授权直接更新 GitHub 默认首页。公开下载版本仍以 Releases 为准，本次不发布安装包；日常运行实例不代表已切换到此源码版本。

## 2026-11-18 拼多多多买家会话错归属与发送定位（1.0.59）

已复现旧代码在 selected 先更新而气泡仍旧时错归属、同文旧气泡误作基线，以及定位与发送分开排队导致 hook_not_ready。复用现有 PDD hook/DOM adapter/PlatformWriteCoordinator 修正，来源与哈希见 vendor/lingtu-runtime/PROVENANCE.md。Codex 独立验证相关 11 文件 89 项通过、Electron 类型与变更文件 ESLint 通过；DeepSeek 退出码 0、final completed，另执行上游 242 项和 vendor 完整性通过。实店重启验收待进行，不能据此声称真实发送已修复；现场两个会话保持 handoff，旧候选不恢复、不自动补发。下一步核对实际版本并用两位测试买家的新消息验收，仅该链路，不运行全量桌面套件。

本机启动核验：2026-11-18 02:23（北京时间）从主项目 client 重启，主进程 PID 115828，真实窗口显示 v1.0.59；build 与 vendor 检查通过。实店双买家新消息验收已请用户配合，尚未完成，不宣称实店通过。

## 2026-11-18 回复监控会话与商品（主目录 1.0.60 工作副本；已并入 1.0.62）

本条是主目录回复监控工作副本的历史记录，不是已验收的 1.0.60 维护整理基线；内容已由 bc6a863 保存并并入 1.0.62。

当前监控按店铺和买家显示对话气泡、已识别咨询商品与候选状态。保留原确认流程和监控子窗尺寸。Codex 独立复跑 54 项专项测试、vendor 完整性与 242 项上游测试，源码构建和 340×300 原生监控检查通过。原生验收报告位于 artifacts/desktop-selected-1794980474063/report.json。真实店铺商品显示尚待新一轮实店验收。

## 2026-11-18 回复监控纵向缩放（1.0.63）

普通回复监控沿用 Electron 原生窗口边缘缩放，宽度 340，默认高度 300。向上拖窗口顶边拉高，向下拖回。新消息、父窗调整和切换开发调试后保留本次运行设定的高度。20 项专项测试及普通监控、开发调试两项原生桌面检查通过，报告见 artifacts/desktop-selected-1794984631794/report.json。已构建并重启主项目源码。

## 拼多多商品主图采集（1.0.64）

修复素材轮播把 AI 角标计为主图的问题，保留缺图及声明数量校验；旧布局兼容图片去重和懒加载来源。商品详情 DOM、采集 provider 和商品记录共 42 项专项测试通过。本机早期修复版完成实店 5 件采集；合入后仍需在发布构建复验商品数量和主图，不将早期版本的结果当作本版实店验收。

主管整合验收补充（2026-11-19，1.0.69）：本批已整合到主目录；未覆盖其余未提交设计文档。Codex 独立执行6文件74项相关测试、4文件98项受影响上游测试，Vue/Electron类型、变更文件ESLint、依赖边界、vendor 80/server 97完整性、主目录build均通过。浏览器只用内存预览数据检查两栏，实测两卡宽381.33px、两文本框高73px，截图位于本机协作目录keyword-settings-20261119/layout.png；这不是实店功能验收。主目录正常资料路径重启，真实窗口显示v1.0.69（PID 141592）；未编辑真实关键词或开关、未发送买家消息。云端构建状态以后续回执为准。
