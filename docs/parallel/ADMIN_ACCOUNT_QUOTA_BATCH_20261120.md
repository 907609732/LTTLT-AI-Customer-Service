# 后台账号批量试用额度调整（2026-11-20）

## 范围

截图中的“试用次数”支持当前页勾选后批量调整。它只修改 `lingtu_trial_grants.call_limit`，不充值、不操作付费/永久额度池、不延长有效期，也不修改 `lingtu_accounts` 的模型、状态、登录会话或原生账号状态。

- 复用 `POST /api/lingtu/admin/config`，请求为 `section=account`、`action=batch_quota`，不新增开放路由。
- 安全证明继续绑定整个精确请求 body 的 `section + SHA-256(request_hash)`；交互登录、管理员角色、单次证明和既有 `LingtuCriticalRateLimit` 不变。
- 每页固定 20 条。勾选只保存在当前页内存中；换页、刷新或响应中的行失效时，不在当前页/不再可批量调整的 ID 会被丢弃。

## 请求与校验

```json
{
  "section": "account",
  "action": "batch_quota",
  "reason": "管理员填写的原因",
  "targets": [
    { "user_id": 9, "expected_limit": 100, "target_calls": 120 }
  ]
}
```

- 严格白名单解码：`targets` 1..20 条、ID 不重复、每条仅允许上述三个字段；未知顶层字段、浮点数、越界值均返回 400。
- `target_calls` 必须是 0..1000000 的整数；原因必填，批量原因上限 180 字节，以便与前后额度一起写入既有 `ManagedAudit.Reason varchar(256)`，不新增迁移。
- 前端三种模式：
  - 增加：`target = 当前总额 + 数量`；
  - 扣减：`target = 当前总额 - 数量`，不得低于 `used + reserved`；
  - 设定：`target = 数量`，同样不得低于 `used + reserved`。
- 预览逐账号显示当前总额、调整后总额和预计剩余。已过期账号的预计剩余显示为 0，且提交不延长有效期。
- 原生停用、已删除、未授权（缺少 `lingtu_accounts` 或 `TrialGrant`）的行不可勾选，也不能通过伪造请求隐式授权。

## 服务端事务

单个事务内先获取既有 `lingtu_trial_limit_gate` 写锁（与 Reserve/Settle 共用），再逐账号重读：

1. 原生用户存在、未删除且 `status=1`；
2. `lingtu_accounts` 存在且 `status=enabled`；
3. `TrialGrant` 存在且 `call_limit == expected_limit`；
4. `target_calls` 位于 0..1000000 且不小于最新 `used+reserved`。

更新使用绝对目标值和 CAS/并发条件：

```sql
UPDATE lingtu_trial_grants
SET call_limit = ?
WHERE user_id = ? AND call_limit = ? AND used + reserved <= ?
```

无变化账号跳过更新（避免 MySQL `RowsAffected=0` 被误判失败），但仍写入审计。任一账号非法或 CAS 冲突则整批回滚，不部分成功、不创建授权。审计与更新在同一事务内提交；外层 pending `ManagedAudit` 保持既有行为。

## 错误与交互

- 校验失败（重复 ID、越界、低于 used+reserved、原因超长、账号禁用/删除/未授权）返回 400 `invalid_request`；仅最新 `expected_limit` 与当前总额不一致时返回 409 `batch_quota_conflict`。前端保留原因、模式、数值和当前页选择，提示刷新核对，不自动重试。
- 成功后统一刷新 `['lingtu']` 查询并清空选择与编辑草稿。
- `busy` 时禁用勾选、全选、调整、取消和提交，并用同步 ref 防重复点击；提交时快照目标列表，避免选择漂移。

## 验证与文件

- Go：真实 HTTP 会话 + 安全证明完整 body 绑定、匿名/错误角色/API key 拒绝、批量原子回滚、CAS、重复 ID、越界、无变化行、审计失败回滚、used/reserved/期限/模型/status/paid/permanent 保留、Reserve 并发计数。
- 前端：勾选/全选/取消、换页与刷新隔离、三种模式/边界/低于 used+reserved、预览、取消、验证取消/失败/改 body、busy 与重复点击、原单账号编辑回归。
- 预计导入文件：`overlay/lingtuhost/admin.go`、`overlay/web/src/features/lingtu/admin-page.tsx`、`server/translations.json`。新增 `overlay/lingtuhost/admin_account_quota.go`、对应测试、`overlay/web/src/features/lingtu/admin-account-quota.tsx` 与现有 `admin-page.test.tsx` 回归。`source-files.json` 只更新实际导入文件哈希并保留上游字段，`PROVENANCE.md` 记录本补丁。

生产部署、真实账号/额度、桌面打包、推送和重启桌面不在本任务范围。

## 实现结果

- 服务端严格解码和事务辅助在 `server/overlay/lingtuhost/admin_account_quota.go`，`admin.go` 只增加分派/错误映射；共享 trial 写锁由新增 `server/overlay/lingtu/admin_quota.go` 的受控导出进入，未改 Reserve/Settle。
- 前端新增 `server/overlay/web/src/features/lingtu/admin-account-quota.tsx`；账号页增加当前页选择列，换页、刷新、响应行失效时只保留当前页仍可调整的 ID。单账号编辑器未改行为。
- 批量原因上限 180 字节，与 `batch_quota before=<n> after=<n>; ` 前缀一起写入既有 `ManagedAudit.Reason varchar(256)`；无变化行仍审计。
- 成功返回 200 `saved=true` 后前端刷新并清选择；400（含账号禁用/删除/未授权、越界、低于 used+reserved）保留输入并提示核对；仅 expected_limit CAS 过期返回 409 `batch_quota_conflict`，前端保留输入并刷新账号列表，不自动重试。`busy` 期间勾选、全选、调整、取消、清除选择、提交、账号上一页/下一页和顶部刷新均禁用，组件 ref 与父级 `saving` ref 双重防重复。

## 验证（本机，2026-11-20）

| 命令 | 结果 |
| --- | --- |
| `go test ./lingtuhost -run TestLingtuAdminBatchQuota -count=1 -timeout=180s` | 前轮已执行通过，exit 0（本轮未重复） |
| `go test ./lingtuhost -run TestLingtu -count=1 -timeout=240s` | 前轮已执行通过，exit 0（146.191s，本轮未重复） |
| `go test ./lingtu -run 'Test(Lingtu|Trial|Concurrent|Settlement|Quota)' -count=1 -timeout=240s` | 前轮已执行通过，exit 0（2.782s，本轮未重复） |
| `bun run test src/features/lingtu/admin-page.test.tsx --maxWorkers=2` | 38/38 通过，exit 0（含 deferred busy/取消/失败恢复回归） |
| `bun run typecheck` | 1,440 文件无类型错误，exit 0 |
| `bun x oxfmt -c .oxfmtrc.json --check src/features/lingtu/admin-account-quota.tsx` | 新增组件通过，exit 0；导入文件保持原混合行尾，未用格式化器重写整文件 |
| `bun x oxlint -c .oxlintrc.json src/features/lingtu/admin-page.tsx src/features/lingtu/admin-account-quota.tsx src/features/lingtu/admin-page.test.tsx` | 无 error，exit 0 |
| `bun run build`（`VITE_MANAGED_API_ORIGIN=https://api-kefu.lttlt.top`） | 通过，exit 0；dist 含生产 API 来源，无 `127.0.0.1:3000` |
| Linux amd64 `go build -trimpath -o ../bin/lingtu-managed .` | 通过，exit 0（最终二进制 SHA256 `88781d67cdb15d4dbaae9e92b564e91966e68347a1fa26bd548efc9270db793c`） |
| `node --test server/tests/preparation.test.mjs` | 2/2 通过，exit 0 |
| `node artifacts/admin-account-quota-20261120/verify-translations.mjs` | 2 个文件、en/zh 各 7,851 条，0 problems，exit 0 |
| `node scripts/check-vendor.mjs` | server 107 个文件、vendor 80 个文件通过，exit 0 |

前轮已执行 Go 覆盖：真实 HTTP 管理员会话 + 完整 body 安全证明、匿名/错误角色/API key 拒绝、stale expected_limit 整批回滚、未授权/原生停用整批回滚、严格白名单/重复 ID/越界/低于 used+reserved、无变化行、审计插入失败回滚、used/reserved/期限/模型/status/paid/permanent/会话保留、Reserve 并发计数。本轮前端覆盖：勾选/全选/清除、换页与刷新隔离、三种模式、边界、预览、取消保留、验证取消/失败、deferred busy 锁定分页/刷新与重复提交、单账号回归。

## 预览

本机隔离 SQLite 运行在 `server/runtime/local-http`，只使用合成账号 `preview_acct_01..20`（ID 9002..9021）；未提交保存，未改任何真实账号额度。截图：

- `artifacts/admin-account-quota-20261120/preview-wide.png`（1006×1000，宽屏选中栏与预览）
- `artifacts/admin-account-quota-20261120/preview-narrow.png`（390×844，窄屏默认视图）
- `artifacts/admin-account-quota-20261120/preview-narrow-scrolled.png`（390×844，预览表在容器内横向滚动到调整后总额/预计剩余）

复现：先按 `server/README.md` 构建本机 Windows 服务（网页 `VITE_MANAGED_API_ORIGIN=http://127.0.0.1:3000`），运行 `server/scripts/start-local.ps1`，再运行 `artifacts/admin-account-quota-20261120/seed-preview.mjs` 写入合成账号；浏览器打开 `http://127.0.0.1:3000/lingtu/admin`。截图由 ego-browser 对真实本机页面拍摄，浏览器扩展浮层已隐藏；截图中未执行“应用到所选账号”。最终生产候选构建前已在 `preview-build.txt` 记录本机预览二进制、网页索引和三张截图哈希；最终网页/Linux 构建来源、退出码和 SHA256 见 `final-builds.txt`。

## 已知限制

- 未运行 MySQL/PostgreSQL 矩阵与全量上游回归；SQLite 定向测试通过不能替代三库验收。
- 未部署生产、未触碰真实账号/额度、未打包桌面、未推送；生产发布须用户在可验收结果上另行授权。
- 截图是本机合成数据；页面显示不代表线上额度已修改。
- 环境中的 `GIT_CONFIG_COUNT` 变量会使部分 Git 读取失败；仅在本机命令前清除该变量，未改仓库或全局配置。
