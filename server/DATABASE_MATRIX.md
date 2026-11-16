# 本机 MySQL / PostgreSQL 隔离验证

## 已安装的工具

当前 Windows 主机没有 Docker/WSL，采用官方独立二进制。工具在工作区之外安装，可被其他项目复用，已写入用户全局 PATH（新终端生效）。本项目脚本直接使用工具路径，无需重启终端。

| 工具 | 版本 | 安装路径 | 许可 |
| --- | --- | --- | --- |
| MySQL Community | 8.4.13 LTS | `E:/DeveloperTools/Databases/mysql-8.4.13-winx64` | GPL-2.0-only |
| PostgreSQL | 18.7 | `E:/DeveloperTools/Databases/postgresql-18.7-1/pgsql` | PostgreSQL License |

下载 URL 和已验证校验和保存在 `database-tools.lock.json`，分发包保留在 `E:/DeveloperTools/Downloads`。MySQL 同时核对官方发布的 MD5 并记录 SHA256；PostgreSQL SHA256 与 Scoop 官方仓库包清单一致。没有安装新的项目运行依赖。

来源：[MySQL 官方 Windows 安装](https://dev.mysql.com/doc/refman/8.4/en/windows-installation.html)、[官方下载页](https://dev.mysql.com/downloads/mysql/8.4.html?os=3)、[PostgreSQL 官方 Windows 入口](https://www.postgresql.org/download/windows/)、[EDB 官方二进制](https://www.enterprisedb.com/download-postgresql-binaries)、[Scoop 包清单](https://github.com/ScoopInstaller/Main/blob/master/bucket/postgresql.json)。Testcontainers/Docker 路线需要本机缺失的容器运行时，因此直接复用官方 Windows 原生命令与项目已有 GORM 矩阵。

## 运行

在项目根目录执行：

```powershell
# service 的三引擎矩阵，以及托管领域/接口的 MySQL、PostgreSQL 全包测试
npm run server:test:databases

# 标准服务端验证 + 上述完整数据库矩阵 + 网页测试/构建与 Linux 编译
npm run server:verify:databases
```

复用已有物理网页构建缓存时，可设置 `YUNDUO_SERVER_BUILD_DIR=E:/WuchengBuilds/lingtu-token-cost-main-20261116`。缓存必须专用于同一源码维护线，切换分支应使用新的空目录，避免旧生成文件残留。这不改变数据库连接。可用 `LINGTU_DB_TOOLS_ROOT` 改变全局工具根目录，工具子目录名称仍按锁定版本；`LINGTU_DB_TEST_ROOT` 改变测试数据根目录，默认 `%LOCALAPPDATA%/Lingtu/DatabaseMatrix`。

排查单项时支持 `npm run server:test:databases -- --focus=TestBillingCheckout`；报告明确标记 `focused`，不能作为完整矩阵通过。`--service-only` 仅运行 service，标记 `service-only`。完整验证入口不传这些参数。

## 隔离与结果

每轮创建独立随机目录、空闲 IPv4 回环端口和随机口令；MySQL 关闭 X 协议，两个数据库都只监听 127.0.0.1。先确认服务器返回的数据目录与本轮目录完全一致，再创建三个测试库及受限测试角色：`lingtu_test`、`lingtu_service_test`、`lingtu_service_test_log`。主库和日志库分开，不读取或接受外部测试/生产 DSN。临时初始化口令文件用后删除。

复用 `service/TestFixedPriceBillingDatabaseMatrix` 的真实预留、结算和日志逻辑，SQLite、MySQL、PostgreSQL 三组都必须通过。随后顺序运行 `lingtu`/`lingtuhost`，包并行度为 1，避免共享测试库相互干扰。任何失败、必需矩阵缺失或意外跳过都会使入口失败。原有 `TestTrialIdentityMySQLExistingSnapshotReadsCurrentClaim` 专门验证 MySQL REPEATABLE READ：要求在 MySQL 通过，在 PostgreSQL 的原有“不适用”跳过不冒充执行。

退出前使用原生命令关闭本轮实例，再确认记录的 PID 和回环端口均已退出；无法确认则报告失败。数据目录保留供排查，实例不会作为系统常驻服务运行。结果为 `artifacts/database-matrix/verification.json`，逐组脱敏 Go JSONL 位于同目录；标准完整入口另外写入 `artifacts/verification.json`。实际结果以最新报告的 `status`、`scope`、各组结果及 `stopped` 为准。

## 本轮发现并修复的问题

完整矩阵以当前提交实际生成的报告为准；只有 scope=full、status=passed、stopped=true 且无清理错误才算通过。

- 原生测试夹具未清理新加入的订单及回执表，导致用例相互污染；在已确认的 `lingtu_test` 数据库内补齐清理，不改变业务断言。
- MySQL 默认返回实际改变的行数，重复保存相同支付附件为 0 行，原逻辑误判为冲突。现在回读并确认相同状态、相同支付会话才承认幂等成功；不同引用、已支付订单依旧冲突。新回归已在 MySQL 先失败后通过，SQLite 和 PostgreSQL 同时验证。参见 [MySQL affected rows 官方语义](https://dev.mysql.com/doc/c-api/8.4/en/mysql-affected-rows.html)。
- Windows 启动流程显式处理 MySQL localhost/IP 授权及 PostgreSQL 后台句柄继承，清理结果按实际 PID/端口核实。

未部署生产服务器、未修改业务数据库或商户配置。
