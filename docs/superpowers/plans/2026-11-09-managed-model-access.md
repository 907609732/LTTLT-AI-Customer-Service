# Managed Model Access Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task. Preserve the ledger across compaction.

**Goal:** 登录后使用服务端模型，公开注册赠送可管理的试用额度。
**Architecture:** 固定 New API 上游提交，加可重放源码 overlay 和少量锚点补丁，编译为同一个 Go 服务；桌面仅通过专用 API 访问。沿用灵兔现有样式，不再确认布局。
**Tech Stack:** Go、Gin、GORM、New API、React、Electron、GitHub Actions。
**Spec:** `docs/superpowers/specs/2026-11-09-managed-model-access-design.md`

## Global Constraints
- 上游固定 `48a6c87f9e7757fdc58e5be9bcb4f8281ad0dfd0`；保留上游许可。
- 20 次、7 天，登录绝对 30 天；微信、钉钉首批同时支持，邮箱备用。
- 上游密钥不返回客户端；桌面令牌不得用于后台；未配置功能明确不可用。
- 独立数据和部署，不能覆盖原工作区或现有服务器业务；不得向真实买家测试发送。
- 用户已选择直接开发、不再确认布局，连续执行；生产配置通过私有入口填写。

## Review Focus
- 注册回调重试、绑定及重启不能重复赠送，Task 1/3 测试。
- 最后一次额度并发和相同请求重试不重复转发，Task 1/4 测试。
- 刷新响应丢失、更新重启不丢登录，Task 2/5 测试。
- 托管账号从浏览器原生网关绕过额度，Task 4 集成测试。
- 切账号及授权失效不能触发买家兜底或读取旧账号数据，Task 5 集成测试。

### Task 1: 可重建上游与试用账本
**Files:** `managed-server/upstream.lock.json`, `managed-server/overlay/lingtu/trial*.go`, `scripts/prepare-managed-server.mjs`, `.gitignore`。
**Interfaces:** `NewTrialStore(db *gorm.DB) *TrialStore`; `Grant(userID int, now time.Time, limit int, duration time.Duration) error`; `Reserve(userID int, requestID, digest string, now time.Time) (Reservation,error)`; `Settle(userID int, requestID, outcome string) error`。
- [ ] 固定上游来源、SHA 与 overlay，构建时拒绝源码漂移。
- [ ] 写失败测试：20 次耗尽、7 天边界、重复发放、重复请求摘要冲突、并发最后一份、失败退款、不确定保留。
- [ ] 执行失败测试；实现事务及条件更新；重跑通过。
- [ ] 三数据库真实矩阵、迁移重复执行；提交。

### Task 2: 桌面认证和会话
**Files:** `managed-server/overlay/lingtu/device*.go`, `session*.go`, `credentials*.go`。
**Interfaces:** `RegisterClientRoutes(router *gin.Engine, deps Dependencies)`；客户端接口以设计中 `/api/client/auth/*` 为准。
- [ ] 写失败测试：设备码过期、轮询限速、拒绝/重放、单次兑换。
- [ ] 实现服务端摘要存储、一次兑换和浏览器确认，遵循 RFC 8628。
- [ ] 写刷新测试：专用 audience/purpose、30 天绝对期限、持久化轮换恢复、撤销及跨端点拒绝；实现后通过。
- [ ] 写凭据密文测试（错误密钥、截断、篡改、留空保持/明确清空），实现 AES-GCM 密钥版本封装。

### Task 3: 微信、钉钉、邮箱身份
**Files:** `managed-server/overlay/lingtu/social*.go`, `identity*.go`, `managed-server/overlay/web/src/features/lingtu/*`。
**Interfaces:** 服务端专用 provider adapters 返回已验证主体；身份唯一约束与注册发放在一致事务中。
- [ ] 对照官方协议写本地 HTTP fixture 测试，覆盖 state、异常/过期/重放、同名不同主体。
- [ ] 实现专用微信 GET、钉钉 JSON 换令牌；不直接套用通用 POST 驱动。
- [ ] 邮箱复用上游验证与恢复机制；未验证不发放；角色字段不可由公共请求写入。
- [ ] 绑定冲突/试用不重复/敏感日志测试通过，提交。

### Task 4: 模型调用和管理后台
**Files:** `managed-server/overlay/lingtu/chat*.go`, `admin*.go`, `policy*.go`, 上游 relay/auth 锚点补丁及管理页面。
**Interfaces:** `/api/client/me`, `/config`, `/chat/completions`；管理员接口由上游角色与 security proof 保护。
- [ ] 测试账号停用、会话撤销、策略限制、上游失败/不确定结果和请求去重；接入 Task 1 账本。
- [ ] 服务端选渠道/模型并复用 relay；封堵托管账号原生 `/v1/*`、`/pg/*` 和 Token 管理绕行。
- [ ] 实现六个管理入口、密钥替换/清空和连通测试，元数据用量与审计；不保存聊天正文。
- [ ] 管理员权限越权、密钥泄露及三数据库矩阵通过，提交。

### Task 5: Electron 与现有账号页
**Files:** `electron/managed-session.cjs`, `electron/main.cjs`, `electron/preload.cjs`, UX25 页面及 backend 模型调用边界、`tests/managed-*.test.mjs`。
**Interfaces:** 主进程独占令牌，renderer 仅状态/登录/登出/可用配置；后端托管请求由主进程授权。
- [ ] 测试加密不可用、离线保留、刷新单飞及更新重启；实现 safeStorage 原子保存和恢复。
- [ ] 沿用 UX25 与灵兔样式接入微信/钉钉/邮箱入口、确认码、余额和登出。
- [ ] 测试账号数据分目录、旧数据认领备份、切换前停止 worker、授权失效阻止买家兜底；实现隔离。
- [ ] 执行 typecheck/unit/backend/build/e2e/Electron 集成；提交。

### Task 6: 云构建、部署与真实验收
**Files:** `.github/workflows/managed-server.yml`, `managed-server/Dockerfile`, `managed-server/deploy/*`。
- [ ] CI 检查固定来源、三数据库、前后端和桌面构建；提供同次可追溯产物。
- [ ] 独立部署、私有管理员初始化、备份回滚、256 MiB 预算与并发负载验证；不足则不上线当前业务机。
- [ ] 核对权威 DNS/现有站点；大陆后端与 TLS 验证后，再实施同域双端前端和地区 DNS。
- [ ] 验证 CORS、重启保留、恢复、TLS 自动续期，逐站记录。
- [ ] 用户在安全后台填写凭据并完成真实扫码/收信；未完成项不得称为已接通。
- [ ] 整分支独立审查、修复并重新验证，最后交付可更新客户端。
