# v1.0.48 发布验收（2026-11-17）

已公开发布：[GitHub Release v1.0.48](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.48)，标记为 Latest，非草稿、非预发布；保留旧版本及其附件。

## 来源与范围

- 标签固定在源码 `12b31cae66e6d9d1b4e0db3cfa7b3ac0448b546f`，客户端版本 1.0.48。
- 相比 v1.0.46，包含 Windows 透明圆角任务栏图标/应用标识修正，以及独立托管服务端的文字 DeepSeek、图片 Qwen3-VL 路由与新库 100 次双模型默认策略。
- Windows 安装包不包含服务端。本次只发布客户端附件，不部署生产服务端、不更改线上账号策略、不执行真实支付或买家发送；旧策略、旧额度不会由安装程序自动改写。

## 验证

- [桌面 CI](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44083476049)成功，包含源码/契约/回归、实际 Electron、知识管理/学习、安装包构建与实际成品启动。
- [服务端 CI](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44083286500)成功，包含 MySQL/PostgreSQL 回归；其后只修改计划文档格式。
- 从桌面 CI 下载确切源码对应产物，核对 RELEASE-MANIFEST 的版本、来源 SHA、构建 URL，3 项 SHA256 全部匹配。
- ZIP 解压到 `E:/codex-builds/lingtu-v1.0.48-release/portable`，使用临时独立 user-data-dir 执行 `npm run test:packaged` 通过：ASAR 9119 成员、无私有/开发文件、真实窗口/preload/业务 IPC、版本、PDF/DOCX/XLSX/PNG 解析通过（8 个解析分段）。未升级安装或改动日常账号。
- [附件上传流程](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44089148887)成功，发布前核对远端 4 个附件的大小及 digest 与本机文件一致。
- 公开后匿名 EXE 请求返回 HTTP 200；README 下载入口同步到 1.0.48。GitHub 的 Source code 附件是源码，不是安装包。

## 附件

| 文件                              |    字节数 | SHA256                                                           |
| --------------------------------- | --------: | ---------------------------------------------------------------- |
| LingtuAI-Setup-1.0.48-win-x64.exe | 143569679 | 772bb1ccc4d3a9d578c397457658cef9d038a17cb3ffa478196155950368c429 |
| LingtuAI-1.0.48-win-x64.zip       | 190861162 | f6771974b54a4816e5c71a10edb8d179f64cbf2c4927031ed426e7928e2e2b3b |
| RELEASE-MANIFEST.json             |       294 | 24955de17c0a5d4ec773b6ea1acf42d4fb0e11327beae9dc1c4d1ebaddfb57d3 |
| SHA256SUMS.txt                    |       285 | 4502237fe68770ef0428df6b558e439d4a825b68c68073f12a4883a3d6b836ae |

安装器未签名，采用手动下载安装；未发布自动更新清单。发布后仅同步 README 和本验收记录，不移动已验证标签、不修改二进制或构建来源。
