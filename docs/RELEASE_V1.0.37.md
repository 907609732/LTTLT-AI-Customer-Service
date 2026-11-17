# v1.0.37 发布验收（2026-11-17）

已公开发布：[GitHub Release v1.0.37](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.37)。

## 源码与范围

- [PR #30](https://github.com/907609732/LTTLT-AI-Customer-Service/pull/30) 已合入 main。
- 标签指向确切源码 925dc2ed4c425aff616cd62bda93056337254ec3，客户端版本 1.0.37。
- 三项修复：日志清除/置顶/原生拖动；拼多多会话定位完整点击与实际 UID 核对；等待审核不占模型名额，其他买家可继续生成，仍保留确认门及同买家独占。
- 同步主干回复间隔验收断言，匹配现有界面文案；无额外产品功能调整，无新增生产依赖。

## 验证结果

- 本机完整 npm run check 通过：974 项单元、232 项上游测试，类型/格式/依赖方向/供应商摘要/构建通过。
- [PR 云端构建](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/43920817222) 与[主干发布构建](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/43922491319) 均成功，桌面完整检查 88/88；知识库管理、资料学习及真实成品启动通过。
- 本机桌面第一次触及 180 秒总时限；延长总时限复跑为 87/88，失败项为日志新窗口置顶状态。本机固定发布提交、补齐前置夹具后的相关流程复验 7/7，未复现置顶失败。未降低断言或改基准图；不把本机全量复跑表述为全通过。
- 下载主干构建的 ZIP，隔离 user-data-dir 实际启动 LingtuAI.exe，npm run test:packaged 通过；ASAR 8842 个成员检查、无私有/开发文件、窗口/preload/业务 IPC、版本显示、PDF/DOCX/XLSX/PNG 解析通过。未对日常账号执行升级安装。
- 真实页面验证过买家间定位与单条新消息生成；多买家待审核并发隔离通过真实引擎合成回归，未补做两位真实买家的连续消息验收，未执行真实买家发送。

## 附件与发布

- 安装包：LingtuAI-Setup-1.0.37-win-x64.exe，143677779 字节。
- 便携包：LingtuAI-1.0.37-win-x64.zip，191121769 字节。
- 同附 RELEASE-MANIFEST.json 与 SHA256SUMS.txt；源码、版本、构建 URL 和本机 3 项 SHA256 匹配。
- [草稿附件上传流程](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/43924400606) 成功，4 个远端附件的 digest 与下载文件逐一一致；公开后再次下载校验文件并匹配。
- 已验证 isDraft=false、isPrerelease=false。保留旧附件与原 latest 通道（v0.5.1），新版本使用明确下载页手动升级；当前包未做代码签名。
- 不包含服务端部署、付款、真实买家发送或发布用户数据。
