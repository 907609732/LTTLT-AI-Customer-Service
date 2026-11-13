# Windows 桌面打包与交付约束

本工程在仓库的 yunduo-ui 目录独立维护；本次分支 codex/yunduo-managed-desktop-release-20261114 基于原拼多多 AI 云朵分支，不覆盖仓库根 React 客户端及 managed-server。云朵内的 server 是单独的托管服务源码，不随桌面安装包运行或分发。

## 构建

用户本次明确选择云端构建：仓库根 .github/workflows/yunduo-desktop.yml 在功能分支推送时执行 Windows 检查、桌面测试、NSIS/ZIP 构建与打包后真实程序验收，成功后上传校验文件并发布独立预览下载。本机仅准备源码和核对产物，不作为本次安装包来源。以下本机构建命令用于后续维护者复现。

Windows + Node/npm，先 npm ci，然后 npm run check、npm run test:desktop。执行 npm run dist:win 生成 release 下的 Windows x64 NSIS 安装程序与 ZIP；npm run pack:win 仅生成解压目录。electron-builder 固定版本并保存锁文件，Electron 沿用项目 33.4.11，未借打包升级运行时。

ZIP 解压后运行 YunduoCustomerService.exe；NSIS 为当前用户安装，可选择目录并创建快捷方式。安装包无代码签名，没有自动更新与发布服务器配置，不得宣称已签名或自动升级。卸载不删除原用户数据。产品显示名称为云朵客服，package name 保持 yunduo-ui-restored，使安装版与当前源码版继续使用原 userData 名称；同时运行时受单实例约束。

## 打包边界

使用显式文件白名单，仅收录 Vue 产物、main/preload、所需固定运行时、生产依赖和来源许可。禁止把 server、.upstream、开发/测试脚本、smoke、源码映射、测试截图、真实聊天、管理员密码、数据库、主密钥、本机配置或浏览器资料打进安装包。server/runtime 和 release 都被 Git 忽略；前者永久保持本机私有。

运行时第三方 LICENSE、来源清单与 PROVENANCE 必须保留。发布前检查 app.asar 的实际成员，并使用真实解包后的程序、隔离 user-data-dir 验证窗口、preload、业务快照、话术和默认 AI 关闭。只看到 EXE 生成不能视为安装包验收。

## 推送与下载

源代码提交到功能分支；EXE、ZIP 与 SHA256SUMS 放独立的 GitHub 预发布 Release，不把大二进制提交 Git，不覆盖旧版本或 latest 更新渠道。Release 与测试报告必须记录同一源码提交。没有生产部署、真实模型调用或买家发送授权的打包验证不得做这些动作。

本机 HTTP 后台是另外启动的服务，地址 http://127.0.0.1:3000/lingtu/admin，只有当前电脑启动它后才可访问；安装版默认仍为本机 Key。托管地址可以由用户在设置中保存，来源/账号切换继续要求重启。不能把开发电脑的账号密码或模型 Key 预置给其他安装用户。
