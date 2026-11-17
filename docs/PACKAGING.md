# Windows 桌面打包与交付约束

## 2026-11-15：v1.0.1 发布授权与验证

**已完成发布**：[v1.0.1 下载页](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.1)，确切源码 `4bfdb7a`。同次云端构建、本机下载校验与真实成品复验均通过，详见 [发布验收记录](RELEASE_V1.0.1.md)。本次使用 `latest=false` 保留旧v0.5.1自动更新入口，当前新版从明确版本链接手动下载。

用户已在本次会话明确要求合入主干并打包发布新版本，授权本次 `v1.0.1` 的main推送、Windows构建与GitHub Release发布；不包含服务端部署、实店操作或真实消息发送。后文“尚未授权Release”为历史约束，本次按此明确授权执行。下载文件使用GitHub Release，不在业务服务器镜像大文件。客户端目前没有软件内自动更新配置，使用安装包手动升级。

本次云端除全量check与桌面验收外，还执行独立知识库管理/资料学习组合验收。成品验收直接启动真实安装包程序，通过仅绑定回环端口的Electron/Node调试接口检查界面、preload、隔离业务IPC及ASAR内的PDF.js、Mammoth、read-excel-file和原生canvas资源。测试先暂停自身子进程，将该进程的窗口保持隐藏；原生截图使用 `capturePage` 的 `stayHidden`，不增加产品环境开关，不接触日常用户目录。仅测试适配器替换临时进程的原生文件选择器，以合成文件验证扫描PDF、Word内嵌图片、XLSX多工作表和PNG。测试完成关闭本次子进程及调试连接。

版本与产物均须以最终Actions源码提交、成品报告和SHA256清单为准；打包成功不等于真实平台或模型语义质量验收。安装包当前无代码签名。

主工程为 E:\~1awucheng\Plastic SCM\AI电商客服软件\client，其内容已作为独立仓库根，package.json、.github、src、electron同级。目录边界见PROJECT_LAYOUT.md，当前基线和结果见HANDOFF.md。server单独构建，不随桌面安装包分发；公开发布和生产部署另行授权。

## 构建

云端配置位于.github/workflows/lingtu-ai-desktop.yml，从仓库根执行，支持手动、Pull Request与main推送。执行Windows检查、桌面测试、NSIS/ZIP构建及成品启动；当前main基线已通过，链接见HANDOFF.md。以下命令供实际打包时复现，日常仍遵守AGENTS的增量验证规则。

Windows + Node/npm，先 npm ci，然后 npm run check、npm run test:desktop。执行 npm run dist:win 生成 release 下的 Windows x64 NSIS 安装程序与 ZIP；npm run pack:win 仅生成解压目录。桌面打包配置位于 config/electron-builder.json，npm 脚本与云端构建显式传入该文件；electron-builder 固定版本并保存锁文件，Electron按锁文件固定为43.8.9。

ZIP 解压后运行 LingtuAI.exe；NSIS 为当前用户安装，可选择目录并创建快捷方式。安装包无代码签名，没有自动更新与发布服务器配置，不得宣称已签名或自动升级。卸载不删除原用户数据。显示名称为灵兔AI电商客服，npm 名称为 lingtu-ai；main 在单实例锁前显式保留原 yunduo-ui-restored 数据目录，显式 --user-data-dir 仍优先。安装 appId 保留旧值以兼容已有安装，品牌与兼容标识见 BRANDING.md。

## 打包边界

使用显式文件白名单，仅收录 Vue 产物、main/preload、所需固定运行时、生产依赖和来源许可。禁止把 server、.upstream、开发/测试脚本、smoke、源码映射、测试截图、真实聊天、管理员密码、数据库、主密钥、本机配置或浏览器资料打进安装包。server/runtime 和 release 都被 Git 忽略；前者永久保持本机私有。

运行时第三方 LICENSE、来源清单与 PROVENANCE 必须保留。发布前检查 app.asar 的实际成员，并使用真实解包后的程序、隔离 user-data-dir 验证窗口、preload、业务快照、话术和默认 AI 关闭。只看到 EXE 生成不能视为安装包验收。

## 推送与下载

当前工作流只读 contents，没有发布步骤或写入令牌。构建成功后，在对应 GitHub Actions 运行页的 Artifacts 下载 lingtu-ai-windows-<提交号>，其中包含 EXE、ZIP、RELEASE-MANIFEST.json 和 SHA256SUMS.txt；lingtu-ai-verification-<提交号> 保存桌面与打包后验收证据，保留 30 天。版本从 package.json 读取，清单记录本次源码提交与构建地址。可用 Get-FileHash -Algorithm SHA256 核对下载包。

用户已明确授权本轮 Git 提交、分支推送和 main 合并，目标及替换范围见 HANDOFF.md；未授权发布 Release。未来需要公开或长期下载时，另行确认发布方式；不要把 EXE/ZIP 放进源码 Git，也不要自动发布到旧项目或覆盖 latest 更新渠道。没有生产部署、真实模型调用或买家发送授权的打包验证不得做这些动作。

当前基线的云端构建与本机成品复验已通过，结果见HANDOFF.md；旧版过程从Git历史查阅。

本机 HTTP 后台是另外启动的服务，地址 http://127.0.0.1:3000/lingtu/admin，只有当前电脑启动它后才可访问；安装版默认仍为本机 Key。托管地址可以由用户在设置中保存，来源/账号切换继续要求重启。不能把开发电脑的账号密码或模型 Key 预置给其他安装用户。

## 手动云端上传已验证产物

`lingtu-release-assets.yml` 仅手动触发：输入已有草稿tag、成功桌面构建run ID和确切源码SHA，复用官方 actions/download-artifact 与 GitHub CLI。校验run成功、tag/manifest源码一致及全部SHA256后，只上传到仍为draft的指定Release，不自动公开。使用Actions短期token的actions:read/contents:write权限，不新增长期密钥。最终仍须核对远程附件digest并明确执行公开发布；不得用它覆盖已公开版本。

## 2026-11-17 图标整合

复用 public/lingtu-ai.ico，构建后位于 dist/lingtu-ai.ico；主窗口和平台窗口引用同一文件，NSIS 的 installer/uninstaller/header 图标均显式配置。关闭签名采用 signExecutable:false，保留 electron-builder 的图标和资源写入。本次源码合并不发布安装包；最终 EXE/安装器/卸载器外观以对应 Actions 产物检查为准。

## 2026-11-17 任务栏圆形透明图标（1.0.47，本地）

旧 ICO 七个尺寸全部 alpha=255，四角是白色实心方块，因此源码运行的任务栏按钮呈方形；这不是图标缺失。`scripts/generate-windows-icon.py` 使用 Pillow 从现有 `src/assets/lingtu-ai-icon.png` 重新排版：保留完整兔子/气泡品牌内容，将外接矩形内缩到圆形半径的86%，再做圆形透明遮罩，避免裁掉兔子耳朵或气泡尾巴。输出仍为 `public/lingtu-ai.ico`，包含16/24/32/48/64/128/256七种PNG帧；生成脚本不参与CI，ICO 提交到仓库。

`electron/windows.ts` 的图标路径改为显式区分源码与打包：源码/`electron:dev` 读取 `public/lingtu-ai.ico`（该命令只构建主进程，dist 可能缺失或过期），打包应用读取 `app.asar/dist/lingtu-ai.ico`。打包应用在创建窗口前调用 `app.setAppUserModelId('top.lttlt.yunduo.customer.service')`，与 NSIS 快捷方式的 AppUserModelID/builder appId 一致，用于稳定任务栏分组。该调用只对打包应用生效，避免源码调试窗口被归到本机已安装的旧快捷方式并沿用旧图标。builder 配置继续保留 `signExecutable:false`，26.18.0 仍执行图标与版本资源编辑，不得改成 `signAndEditExecutable:false`。

本机证据：旧安装目录实际是1.0.24（app.asar无 dist/lingtu-ai.ico，EXE 资源为 Electron 43.8.9 默认图标），所以“安装版不是品牌图标”来自旧安装包而非当前 builder 配置；1.0.45 便携版 EXE 已含七尺寸品牌 ICO（但仍为不透明方形）。1.0.47 只验证源码构建、ICO 尺寸/alpha 和针对性测试，未重新打包或复验安装包 EXE。
