# service 全包测试修复

## 2026-11-17 成本与生产支付/额度/摘要合并回归

本轮只验证合并直接影响的 Go 包，未运行完整 server:verify、MySQL/PostgreSQL 矩阵、网页依赖安装或构建（由父任务统一执行）。准备命令：

```powershell
$env:HTTP_PROXY=''; $env:HTTPS_PROXY=''; $env:ALL_PROXY=''
node server/scripts/prepare.mjs
# Managed server prepared: ...\.upstream @ 48a6c87f9e7757fdc58e5be9bcb4f8281ad0dfd0
```

在 server/.upstream 内清空 LINGTU_TEST_ENGINE/LINGTU_TEST_DSN 后运行：

| 命令 | 结果 |
| --- | --- |
| `go test ./lingtu ./lingtuhost -count=1 -timeout=900s` | 通过；lingtu 7.330s，lingtuhost 125.048s，退出码 0 |
| 定向支付/额度/摘要/成本用例（见下）`go test ./lingtu ./lingtuhost -run '...' -v` | 39 PASS，0 FAIL；lingtu 2.146s，lingtuhost 26.202s，退出码 0 |

定向集合覆盖：试用/付费额度独立与续费、混合额度并发不超扣、辅助摘要免扣但可对账、Stripe 只入账一次与回滚、Stripe/Native 附件幂等、微信订单号长度、Native 身份/金额/状态校验、Native 查询超时与关闭竞态、商户配置加密隔离、摘要输入约束与重放不重复成本、价格快照不可回推、微元舍入与溢出、换模型不继承旧价。测试只使用临时 SQLite/内存 fixture 和模拟模型，不调用真实支付或模型。

注意：prepare.mjs 复用已有 .upstream 时不会删除覆盖层已移除的文件；本轮曾删除与生产测试重名的 lingtu/billing_checkout_retry_test.go，重跑 prepare 后需确认该文件不在 .upstream 中（全新克隆无此问题）。


2026-11-16：重跑 `go test ./service -count=1 -timeout=180s` 确认原有 82 条失败（含子用例）。主要报错为 `managed credential encryption unavailable`：托管适配已让 `model.Channel.Key` 使用加密序列化，原生 service 的 `TestMain` 仍只建立内存数据库，没有设置运行时 Vault。渠道种子写入失败后，计费、任务轮询和通知测试无法进入业务断言。

复用已有 `lingtu.NewVault`/`SetEncryptionVault`，在原生测试入口中初始化进程内随机 32 字节密钥；不读取环境主密钥文件、不连接生产数据库，不修改生产加密、错误处理、账本或扣费逻辑。新增 `TestLingtuServiceTestCredentialsRemainEncrypted` 验证数据库原文为密文、GORM 读取能还原凭据；该测试先因缺少 Vault 失败，再修复初始化并通过。

维护源码为 `overlay/service/lingtu_test_environment_test.go`，原生 `TestMain` 通过 `patches.json` 的单一精确锚点接入；`.upstream` 继续由 prepare 重建。无需新依赖或升级上游，保留原许可证和来源摘要。

## 验证入口

默认 npm run server:verify 运行完整 service SQLite 套件，并显式清空可选外部数据库 DSN。npm run server:verify:databases 另创建本轮隔离 MySQL/PostgreSQL 实例并执行 service 三引擎及托管双引擎全包回归；不把 SQLite 校验等同于多数据库通过。

实际步骤、失败数与清理结果以 artifacts/verification.json、artifacts/database-matrix/verification.json 及脱敏 JSONL 为准。GitHub 工作流同样在临时服务容器中执行完整三引擎 service 套件。未删测试、未放宽断言，生产加密、账本与扣费逻辑保持原有约束。
