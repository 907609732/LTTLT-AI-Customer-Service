# service 全包测试修复

2026-11-16：重跑 `go test ./service -count=1 -timeout=180s` 确认原有 82 条失败（含子用例）。主要报错为 `managed credential encryption unavailable`：托管适配已让 `model.Channel.Key` 使用加密序列化，原生 service 的 `TestMain` 仍只建立内存数据库，没有设置运行时 Vault。渠道种子写入失败后，计费、任务轮询和通知测试无法进入业务断言。

复用已有 `lingtu.NewVault`/`SetEncryptionVault`，在原生测试入口中初始化进程内随机 32 字节密钥；不读取环境主密钥文件、不连接生产数据库，不修改生产加密、错误处理、账本或扣费逻辑。新增 `TestLingtuServiceTestCredentialsRemainEncrypted` 验证数据库原文为密文、GORM 读取能还原凭据；该测试先因缺少 Vault 失败，再修复初始化并通过。

维护源码为 `overlay/service/lingtu_test_environment_test.go`，原生 `TestMain` 通过 `patches.json` 的单一精确锚点接入；`.upstream` 继续由 prepare 重建。无需新依赖或升级上游，保留原许可证和来源摘要。

## 验证入口

默认 npm run server:verify 运行完整 service SQLite 套件，并显式清空可选外部数据库 DSN。npm run server:verify:databases 另创建本轮隔离 MySQL/PostgreSQL 实例并执行 service 三引擎及托管双引擎全包回归；不把 SQLite 校验等同于多数据库通过。

实际步骤、失败数与清理结果以 artifacts/verification.json、artifacts/database-matrix/verification.json 及脱敏 JSONL 为准。GitHub 工作流同样在临时服务容器中执行完整三引擎 service 套件。未删测试、未放宽断言，生产加密、账本与扣费逻辑保持原有约束。
