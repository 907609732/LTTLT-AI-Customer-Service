# 灵兔 AI v1.0.1 发布验收

北京时间2026-11-15 20:39:11已发布 [v1.0.1](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.1)。用户明确授权本轮合入、main推送、打包及GitHub Release发布。最终源码/tag为 `4bfdb7a8c17549866519433b2d0897d5e4583540`，以下成品全部来自 [Windows Actions 43713449553](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/43713449553)，不是本机重新打包的文件。

## 下载与校验

| 文件                             |    字节数 | 下载                                                                                                                         |
| -------------------------------- | --------: | ---------------------------------------------------------------------------------------------------------------------------- |
| LingtuAI-Setup-1.0.1-win-x64.exe | 143358562 | [安装程序](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.1/LingtuAI-Setup-1.0.1-win-x64.exe) |
| LingtuAI-1.0.1-win-x64.zip       | 190292421 | [ZIP](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.1/LingtuAI-1.0.1-win-x64.zip)            |
| RELEASE-MANIFEST.json            |       293 | [源码与构建清单](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.1/RELEASE-MANIFEST.json)      |
| SHA256SUMS.txt                   |       283 | [校验清单](https://github.com/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.1/SHA256SUMS.txt)                   |

安装程序SHA256：`24db17432eee9cf205b935dcabf69092eaa06ef7f43fbceedf6497abc6b5a5cb`。

ZIP SHA256：`b2ddc6e7af597b3a1482f7c4a18429676193f167b8e7baa90b5cd31777103ba6`。

下载后核对清单中的三项文件hash、manifest版本与源码提交；上传草稿后另核对GitHub返回的全部四个附件digest/大小与远程tag，随后正式公开。发布ID为446049233，正式版、非草稿、非预发布。使用 `latest=false`，已核对旧v0.5.1的Latest发布ID及全部资产ID/大小/hash不变；新版从以上明确版本入口手动下载，不冒充旧应用自动更新包。

## 实际验证

| 范围                                   | 结果                                                                                                       |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 同次云端 `npm run check`               | 类型、lint、格式、边界、vendor校验与构建通过；120个Vitest文件853项通过，上游232项通过                      |
| 同次云端 `npm run test:desktop`        | 真实Electron 85/85通过，含托管账号切换、实际训练/调试与确认发送夹具                                        |
| 知识库管理/资料学习组合                | manager 13项、ingestion 7项通过                                                                            |
| 云端NSIS/ZIP及 `npm run test:packaged` | 构建及成品7项通过，8713个ASAR成员、8部分真实资料解析，visibleWindows=false                                 |
| 本机下载同次ZIP后复验                  | manifest/全部文件hash通过；ASAR package为lingtu-ai/1.0.1；真实程序7项通过，8部分解析，visibleWindows=false |

本机验收直接使用下载ZIP内的 `LingtuAI.exe`、真实main/preload与ASAR依赖，覆盖扫描PDF、Word内嵌图片、Excel全部工作表、PNG。仅本次隔离子进程保持隐藏，并替换其原生文件选择器输入合成文件；没有增加产品测试开关。成品验收对象为ZIP中的真实程序，安装向导操作由用户手动完成。所有模型/账号/买家均为临时数据和本机HTTP夹具。

## 发布过程中修正

- 主进程任务服务可在托管账号初始化前装配，实际请求仍受账号租约保护，关闭后拒绝重新注册。
- 旧训练入口通过当前活动绑定和有效审核版商品知识识别商品，保持旧商品行不变、草稿不能触发商品训练；共享知识另存本店草稿时，不影响其他店仍有效的审核版。
- SQLite主库、快照、备份检查及恢复合并统一使用Node内置Windows命名空间路径，解决深层托管账号目录无法打开/备份的问题，账号目录与恢复守卫保持原样。
- 修复旧桌面日志验收入口，按当前“回复监控→高级日志”进入，保留可见/置顶/单窗和发送确认断言。

前两组回归先观察失败再修正；相关组合53项、深目录/备份/恢复中断组合43项通过，随后纳入上述同次全量检查。新增变更经过独立只读复审，Important全部关闭。未引入新依赖或修改vendor；实际复用库、许可与用途见 [KNOWLEDGE_LIBRARY.md](KNOWLEDGE_LIBRARY.md)。

## 交付与后续验收

安装包无代码签名，当前客户端使用手动下载升级。保留既有userData和登录分区；大文件只放GitHub Releases。生产服务、真实商户计费、实店PDD/CDN、真实模型OCR/图示语义及物理断电不属于本次测试结果。恢复中断时仍停止启动，按知识库维护文档保全材料后处理。

用户保存当前草稿后，可手动安装或解压运行，核对店铺右键“导入知识”和配置中心“商品知识→查看商品”进入同一知识库，再用所选店铺资料完成导入、学习、人工审核与试问。后续实店、模型质量和真实买家发送分别验收。本文件及发布后的下载入口更新仅为文档，不改变上述tag对应的二进制。

本机本轮完整日志、下载包和验收报告保留于 `artifacts/release-v1.0.1/`；对应云端verification artifact保留30天。Release附件长期保留，不清理其他工作树、安装包或用户数据。
