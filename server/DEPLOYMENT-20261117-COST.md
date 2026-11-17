# 2026-11-17 正式人民币成本估算部署

正式服务已切换为 `2026.11.17-cost.1`，源提交 `09be510281722f989b1da58cdfb21f8201cbaa1f`，保留生产已有微信支付、付费额度与摘要免调用扣费功能。

- GitHub [同一提交的构建与数据库矩阵](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44008109806)成功。
- 本机标准验证及完整 MySQL / PostgreSQL 隔离矩阵均通过；矩阵清理无错误，进程已停止。PostgreSQL 一项 MySQL 专用测试按设计跳过。
- 正式目录 `/opt/lingtu-kefu/releases/20261117-token-cost.1`；旧目录 `/opt/lingtu-kefu/releases/20261116-wechat-native.1` 保留。
- 备份位于服务器 `/opt/lingtu-kefu/backups/20261117-token-cost.1`，包含停服后的一致数据库与受限配置；不下载业务数据或密钥。
- 切换约 2 秒；服务正常，Nginx 配置检查通过。切换时原业务数据和凭据配置比对一致。回滚应切换旧 release 并保留最新账本，不覆盖上线后新增数据。
- 正式 HTTPS API 返回新版本及 `token-cny-cost-estimates` 能力；已登录后台显示人民币汇总、已计价与未计价调用数。已有 164 次无价格快照调用保持未计价。
- 未创建支付订单、未发起付费模型测试，未修改 DNS、TLS 或其他站点。

## 官方价格配置进度

用户选择按服务商官方公开人民币价。DeepSeek 实际连接为 `https://api.deepseek.com` / `deepseek-flash`。按[官方高峰价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)填写输入 2、输出 8、缓存命中 0.04 元/百万 Token，用户完成正式管理员密码验证后已保存，刷新回读并只读检查正式数据库确认生效。空闲时段官方价减半，当前版本固定单价估算不自动切换时段。

另一实际模型为 `qwen3-vl-plus`，已核对连接 `https://dashscope.aliyuncs.com` 为北京接口，完成独立管理员验证并保存了对应单价，不能采用 Qwen Plus 文本模型单价。[官方北京标准档](https://help.aliyun.com/zh/model-studio/qwen3-vl-plus)输入不超过 32K 时为输入 1、输出 10、缓存命中 0.2 元/百万 Token；长上下文有不同阶梯，当前估算配置不自动切换阶梯。

两条连接均已保存并经刷新回读确认。用户随后明确同意历史用量按当前价回算展示，历史账目不改写。153 次能精确匹配现有连接的历史用量只读试算为 0.473349 元，另外 11 次因缺少连接证据保留未计价。

## 2026.11.17-cost.3 正式最终验收

正式运行版本为 2026.11.17-cost.3，源提交 1ff8eed2da65607a0d83a1cd6aa9abf1cbb36be4。已推送 main；[同提交服务端 GitHub 构建与数据库矩阵](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44019384227)全部成功。此前 cost.2 已升级为本版本。

- 正式目录：/opt/lingtu-kefu/releases/20261117-token-cost.3；切换前为 20261117-token-cost.2。旧版及备份均保留。
- 备份：/opt/lingtu-kefu/backups/20261117-token-cost.3；原子切换约 2.94 秒。运行程序路径、公开版本探针、Nginx 检查均通过。
- 标准服务验证 11 步通过，原生后台 9 文件 52 项测试通过；service 三引擎 512 项、托管 MySQL 210 项、PostgreSQL 209 项通过，另 1 项 MySQL 专用测试按设计跳过。隔离进程停止，清理错误为空。
- 隔离候选及正式切换均核对所有既有业务字段和凭据配置不变。数据门禁仅允许启动追加的原生 model_update 调度记录，全部既有调度历史仍逐字段保护；候选关闭该后台检测，未跳过账户、支付、额度或用量字段。
- 线上有 72 条旧记录只有快照标记而价格为空。原标记、空价格和费用状态不改写，单独按当前匹配价格估算；有效价格快照及免费零价仍优先。
- 已登录正式后台实际检查今日、本月金额、按日汇总与近 12 个北京时间自然月汇总，日/月金额一致。历史回算、有效快照和未计价调用分开展示；截图及实际金额记录保存在本机忽略的验收目录。
- API 与账号 HTTPS 两端费用资源摘要均为 6db341f014686861fc63ef418a0889363fb3fdfaa8cb6da84b948e6cebe6a9ff，资源路径 /static/js/async/49471.4d8e34d355.js。
- 后端补充修正未改变网页，完整文件树摘要确认一致后复用 cost.2 网页，减少约 20 MB 上传；未改 DNS/TLS 或其他站点，未创建支付订单或发起付费模型检测。

最终程序 SHA256：9a486483e338eff81f35164574647f6abc37466a21e6b3596dece79d68f69b85。修改源码归档 SHA256：69625680f6651e67bc6f5d6acff2e3f10f8d3ccd52453b9ef68788ac33c8ab79。正式服务器 accepted-validation.json 绑定上述源码、程序、本机回归与云端同提交结果。

### 独立桌面工作流的未解决项

[桌面 CI 44019384301](https://github.com/907609732/LTTLT-AI-Customer-Service/actions/runs/44019384301)在随后合入的知识库采集隔离验收 openToolbarMenu 阶段失败，非本次服务端费用改动。完整失败日志保存在 server/artifacts/cost-report-unrelated-desktop-ci-failure.log。该失败不包含在“服务端构建与测试通过”的结论中，本次未修改知识库实现。
