# 灵兔 AI 主项目交付至 main

用户明确授权本次建立分支并交付到 main。唯一工作目录为 F:\Setupgod\yunduo-ui；目标仍为 907609732/LTTLT-AI-Customer-Service，不新建另一个仓库。交付分支为 codex/lingtu-ai-main-project-20261114，初始主分支为 b09fdaf752f6a675df3a17dbe44802b34d0fd550。

## 当前目录树

本工程 package.json、.github、src、electron、public、server、vendor、scripts、tests、docs 和根配置直接位于仓库根。main 不再同时保留旧 React 工程入口、外层 desk-v1、managed-server 或额外 yunduo-ui 子项目；这些旧目录从本次当前树移除，完整版本历史仍在 Git 中，可追溯和撤回。不强制推送，不重写 main 历史。

保留现有仓库 LICENSE、LICENSING.md、COMMERCIAL_LICENSE.md、THIRD_PARTY_NOTICES.md 原文，以及本项目 vendor/server 的来源、摘要和许可。其他 F:\Setupgod 下的文件夹保持原样，不复制或删除它们。现有用户数据目录、账号、平台分区和安装兼容标识保持 BRANDING.md 所述策略。

## 排除范围

node_modules、dist、dist-electron、release、artifacts、覆盖率、server/.upstream、server/bin、server/artifacts、server/runtime、.env、日志、管理员凭据、密钥、数据库、浏览器资料和真实聊天不得提交。提交前核对 Git 暂存清单、来源摘要和本机已知凭据匹配；不输出或复制凭据内容。

## 验证与合并

当前本机已有 83 项单元、229 项上游回归、最终 78 项桌面验收、正式入口隔离启动与解码截图；后台有 9 个 SQLite Go 包、1,428 文件类型、36 项前端测试及网页/Linux 构建证据。手动续跑与环境截止的完整说明保留在 VALIDATION.md，不冒称自动验证全程返回 0。

本次通过分支和 Pull Request 审阅完整根目录替换，云端用 .github/workflows/lingtu-ai-desktop.yml 从仓库根检查、构建并验收 Windows 产物。确认分支 SHA、云端结果和实际文件范围后再合并 main，并核对合并后的文件树。工作流只读并保存 Actions Artifacts，不创建 Release；本次授权不包含生产部署、外部消息或真实买家发送。
