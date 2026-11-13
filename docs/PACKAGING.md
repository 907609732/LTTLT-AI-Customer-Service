# Windows 桌面打包与交付约束

主工程为 F:\Setupgod\yunduo-ui，未来作为独立仓库时，其内容直接位于仓库根：package.json、.github、src、electron 同级。目录边界见 PROJECT_LAYOUT.md。server 是单独的托管服务源码，不随桌面安装包运行或分发。目标仓库与交付分支已按 MAIN_DELIVERY_20261114.md 确定，本轮允许按 MAIN_DELIVERY_20261114.md 建立交付分支并合并 main，公开发布仍须另行授权。

## 构建

云端配置位于本工程 .github/workflows/lingtu-ai-desktop.yml，从仓库根执行，无外层 yunduo-ui 工作目录、路径前缀或历史分支名。支持手动运行、Pull Request 与 main 推送；执行 Windows 检查、桌面测试、NSIS/ZIP 构建与打包后真实程序验收。整理阶段已完成本地静态检查；本轮按用户最新指令推送并合并 main，将以同一源码提交的云端结果核对交付。以下本机构建命令用于后续维护者复现。

Windows + Node/npm，先 npm ci，然后 npm run check、npm run test:desktop。执行 npm run dist:win 生成 release 下的 Windows x64 NSIS 安装程序与 ZIP；npm run pack:win 仅生成解压目录。electron-builder 固定版本并保存锁文件，Electron 沿用项目 33.4.11，未借打包升级运行时。

ZIP 解压后运行 LingtuAI.exe；NSIS 为当前用户安装，可选择目录并创建快捷方式。安装包无代码签名，没有自动更新与发布服务器配置，不得宣称已签名或自动升级。卸载不删除原用户数据。显示名称为灵兔 AI，npm 名称为 lingtu-ai；main 在单实例锁前显式保留原 yunduo-ui-restored 数据目录，显式 --user-data-dir 仍优先。安装 appId 保留旧值以兼容已有安装，品牌与兼容标识见 BRANDING.md。

## 打包边界

使用显式文件白名单，仅收录 Vue 产物、main/preload、所需固定运行时、生产依赖和来源许可。禁止把 server、.upstream、开发/测试脚本、smoke、源码映射、测试截图、真实聊天、管理员密码、数据库、主密钥、本机配置或浏览器资料打进安装包。server/runtime 和 release 都被 Git 忽略；前者永久保持本机私有。

运行时第三方 LICENSE、来源清单与 PROVENANCE 必须保留。发布前检查 app.asar 的实际成员，并使用真实解包后的程序、隔离 user-data-dir 验证窗口、preload、业务快照、话术和默认 AI 关闭。只看到 EXE 生成不能视为安装包验收。

## 推送与下载

当前工作流只读 contents，没有发布步骤或写入令牌。构建成功后，在对应 GitHub Actions 运行页的 Artifacts 下载 lingtu-ai-windows-<提交号>，其中包含 EXE、ZIP、RELEASE-MANIFEST.json 和 SHA256SUMS.txt；lingtu-ai-verification-<提交号> 保存桌面与打包后验收证据，保留 30 天。版本从 package.json 读取，清单记录本次源码提交与构建地址。可用 Get-FileHash -Algorithm SHA256 核对下载包。

用户已明确授权本轮 Git 提交、分支推送和 main 合并，目标及替换范围见 MAIN_DELIVERY_20261114.md；未授权发布 Release。未来需要公开或长期下载时，另行确认发布方式；不要把 EXE/ZIP 放进源码 Git，也不要自动发布到旧项目或覆盖 latest 更新渠道。没有生产部署、真实模型调用或买家发送授权的打包验证不得做这些动作。

旧仓库 2026-11-14 的预览包及其测试属于历史，见 RELEASE_20261114.md；不能用旧工作流成功代替本轮独立根目录配置的云端执行结果。

本机 HTTP 后台是另外启动的服务，地址 http://127.0.0.1:3000/lingtu/admin，只有当前电脑启动它后才可访问；安装版默认仍为本机 Key。托管地址可以由用户在设置中保存，来源/账号切换继续要求重启。不能把开发电脑的账号密码或模型 Key 预置给其他安装用户。
