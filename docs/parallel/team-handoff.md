# 团队权限、店铺授权与工单分配接入

## 统筹装配入口（本窗口未改公共文件）

1. server/overlay/lingtuhost/routes.go 的 `authenticated := group.Group("", h.clientAuth)` 后加 `if err = h.registerTeams(authenticated); err != nil { return err }`。独立 team.go 自行迁移七张 lingtu_team\* 表并注册，复用 identityOf 和原生已启用账号校验。无需增加 Host 字段或修改公共迁移清单。
2. account 公开出口提供 createTeamService/teamServiceKey：`app.provide(teamServiceKey, createTeamService(request => desktop.teamRequest(request)))`。desktop.teamRequest 为统筹新增的受限 IPC；无 provider 页面明确未接通。
3. 主进程映射 `managed.serviceRequest(request.path, {method:request.method, body:request.body})`；path 是下列 /teams 路径，不带 /api/client。不导出 token。校验托管模式、已登录、工作区匹配、无需重启和白名单方法/参数；本机拒绝。Schema 当前位于 account/services/team-service.ts；公共边界不允许主进程引用模块时，统筹可移入 shared/contracts/team.ts 后让模块 re-export。

## 已实现 HTTP 契约

- GET /api/client/teams → `{teams:[{team:{id,ownerId,name,revision},member:{teamId,userId,role,state}}]}`，本人 active/invited 团队。
- POST /api/client/teams body `{name}` → 201 Team；每账号最多拥有一队。
- GET /api/client/teams/:id → teamSnapshotSchema：team/self/members/shops/grants/tickets/notes/audits。
- POST /api/client/teams/:id/accept body `{}` → `{ok:true}`，仅定向受邀本人接受。
- POST /api/client/teams/:id/actions body TeamCommand → `{ok:true}`。
- 公开 teamCommandSchema 为 strict discriminatedUnion：invite(userId,role)、member(userId,role,active)、register-shop(shopId,name)、grant(userId,shopId,allowed)、create-ticket(shopId,text)、assign(ticketId,userId，0回收)、status(ticketId,status)、note(ticketId,text)。所有动作带正整数 revision。
- role: owner/admin/agent/auditor；成员 state: invited/active/disabled；工单 status: pending/working/waiting/done。
- 400 team_invalid_request，401 unauthorized，403 team_forbidden，404 team_not_found，409 team_revision_conflict，503 team_temporarily_unavailable。不回传 SQL 或个人资料。
- 快照最多最新200工单、500跟进、100审计，界面明确上限；非主管只看到自己成员记录和授权店铺业务数据。

## 业务边界

所有者管理成员/店铺/授权；主管分配工单；客服可在授权店铺登记，仅获分配后可改状态/跟进；质检只读授权店铺。邀请已有启用账号，受邀本人接受才生效，不发短信不自动建账号。授权撤销/停用/角色变更均回收旧分配；角色变更清空旧店铺授权。事务争用团队revision栅栏，权限与写入不脱节，不依赖单进程内存锁。审计不含工单正文。

团队店铺仅为软件业务命名空间，不是已验证的平台所有权；不分享平台Cookie/密码/Key/会话，不迁移本机工单，不连接远程平台执行器。本轮没有真实买家操作。

## 生命周期

useTeamWorkspace 监听 workspaceId、API来源、账号ID、可用状态，清空快照和选择；epoch 丢弃晚到响应，卸载清理。无新增渲染层持久化、密钥或长期缓存。各页面独立刷新服务器快照；不乐观冒充保存成功；保存后刷新失败明确提示先核对勿重复提交。

## 文件与验证

新增 server/overlay/lingtuteam/{team.go,http.go,team_test.go}、lingtuhost/team.go；account/services 两文件、替换 TeamPanel、account/index 出口；quality TeamWorkOrderPanel、ShopWorkOrderPanel本机/团队切换、quality/index；tests/team-service.test.ts。另有 TEAM_PERMISSIONS.md 设计计划。

### 本窗口最终验证（2026-11-14）

- Go 独立领域和 HTTP：`go test -mod=mod -p 1 -count=1 -v ./...`，在忽略目录 server/artifacts/team-check（拷贝本领域四个 Go 文件及测试）执行，**5/5 通过**。覆盖真实 SQLite 持久化、HTTP 验证身份、严格JSON/多余字段/尾随JSON拒绝、已有启用账号邀请检查、本人接受、邀请列表可见、撤销邀请后无法接受、禁用成员无法读、跨租户工单访问拒绝、只读质检不得修改、店铺撤权隐藏/回收分配、管理员不许改所有者、旧revision冲突和拒绝操作事务回滚。未prepare公共 .upstream，未跑服务端全量验证。
- 客户端：`npx vitest run tests/team-service.test.ts tests/team-workspace.test.ts --maxWorkers=1 --minWorkers=1`，**8/8 通过**。验证typed transport路径和body、禁止未知字段/缺版本、错误响应拒绝、本机不可用无调用、invited列表展示和点击本人接受、换账号迟到响应丢弃、保存后刷新失败提示、不为只读质检展示创建/分配入口。
- `npx vue-tsc --noEmit --pretty false` **退出0**；这是为 Vue 模板和跨模块公开类型运行的类型检查，不代表全量业务通过。
- 对本窗口 account/quality 改动和两测试文件定向 ESLint **退出0**；同范围 Prettier 检查通过（最终再核对格式输出）。未执行全量 npm run check、build、Release、公共dist重建或桌面主程序重启。
- ego-browser 真实浏览器隔离预览：看到了所有者成员/店铺页面、只读质检团队工单、本机不可用提示。质检没有创建/分配入口；DOM测量无横向溢出。**截图接口连续超时，未得到可用截图，不能声称像素/视觉验收通过**。脚本/fixture在忽略目录 artifacts/team-ui；无真实账号/店铺/买家、写入明确禁用；任务空间已结束，专用5199预览进程已停止。

Go独立验证复用 Gin1.9.1/GORM1.25.12/SQLite1.11.0缓存；系统环境代理127.0.0.1:10090失效，仅验证子进程取消代理，未改全局环境。未真实电商平台验收、未 MySQL/PostgreSQL 矩阵、未生产部署。来源与开源选择见 TEAM_PERMISSIONS.md；没有新增生产依赖。

### 当前公共装配状态和剩余验收

统筹已修改公共注册/IPC与 App provider，本窗口只读核对入口，不覆盖公共文件。当前 App 使用 `desktop.managedBusinessRequest({workspaceId, request:{endpoint:path,method,body}})`，不是早期建议的独立 teamRequest；服务接口兼容。邀请列表确实返回本人的 invited memberships，TeamPanel 在主团队选择器之外单独渲染邀请卡片并提供“接受邀请并加入”；不会因没有 active 团队而隐藏邀请。

统筹还需串行运行整体原生服务端接线、真实Electron隔离集成验收。请在新的临时托管账号上验收创建团队→邀请已有成员→本人接受→登记团队店铺→授权→登记工单→主管分配→成员状态/跟进→撤权后不可见/回收。店铺登记只验证软件团队命名空间，不验证平台所有权，不分享平台登录；团队工单与本机工单独立，若要同步既有本机记录/平台会话仍需新安全契约。列表当前明确限制最新200工单/500跟进/100审计，暂无历史分页，不应作为完整历史导出。

最终文件补充：server/overlay/lingtuteam/http_test.go、tests/team-workspace.test.ts、account/quality README。审计保存role/active/allowed/status变更结果且不含正文；所有者界面可查看变更结果。未改公共 AGENTS/HANDOFF/DECISIONS、未自行提交/推送/合并。
