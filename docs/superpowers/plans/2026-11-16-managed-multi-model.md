# Managed Multi-model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 支持全部或指定多个托管模型，账号模型只作默认偏好。
**Architecture:** 复用现有 New API 托管连接、Gin/GORM、原生 React 表单；范围策略集中解析，配置和聊天使用同一目录。
**Tech Stack:** Go、Gin、GORM、React、TypeScript、Vitest。
**Spec:** ../specs/2026-11-16-managed-multi-model-design.md

## Global Constraints

- 不操作生产数据库、密钥、部署；保留现有未提交改动，原工作区交付。
- 旧配置无范围时维持旧单模型；旧客户端不传模型继续使用默认。
- 不增加依赖，不泄露渠道或凭据；只验证改动及直接影响。

## Review Focus

- 默认失效和指定列表为空：前者稳定回退，后者拒绝保存。
- 显式请求不允许模型：拒绝而非替换。
- 同请求 ID 改模型：拒绝冲突，不能返回其他模型的结果。
- 禁用、删除及设默认操作不得绕过范围约束。
- 旧策略及无模型请求兼容，不向客户端返回密钥。

### Task 1: 策略和目录

**Files:** `server/overlay/lingtu/settings.go`, `server/overlay/lingtuhost/model_policy.go`, `model_policy_test.go`, `admin.go`, `admin_models.go`。
**Interfaces:** 策略新增 `model_scope`（空/全部 all/指定 selected）与 `allowed_models`；目录返回安全的 id/name。

- [x] 先写范围解析、默认回退和保存校验测试，运行确认失败。
- [x] 实现统一目录/选择函数；管理员保存及连接删除/设默认维护策略一致性。
- [x] 运行 `go test ./lingtu ./lingtuhost -run 'Test.*(ModelPolicy|ModelDefault|Connections)' -count=1`，应通过。

### Task 2: 配置和调用

**Files:** `routes.go`, `chat.go`, `model_policy.go`, `model_policy_test.go`。
**Interfaces:** `chatInput.Model` 可选；返回 models 和有效 default_model；摘要哈希纳入显式模型且保留空模型旧摘要。

- [x] 添加配置多模型、越权调用、模型摘要冲突和兼容测试，观察失败。
- [x] 配置/聊天统一选择规则，保留已有计费与渠道绑定。
- [x] 运行相关 Go 测试并确认通过。

### Task 3: 后台选择与交付

**Files:** `admin-page.tsx`, `admin-page.test.tsx`, 翻译覆盖层、`server/source-files.json`, `server/PROVENANCE.md`, `docs/MANAGED_SERVICE.md`。

- [x] 添加范围切换、多选保存、默认选项过滤测试并确认失败。
- [x] 实现全部/指定模型控件，更新契约及维护说明。
- [x] 更新导入文件实际哈希；准备生成树，运行受影响 Go/原生前端测试、类型检查及构建。
- [x] 独立审查本次差异并处理实际缺陷；交付局部验证结果和未验收项，不自动提交、推送或部署。

## 执行记录

使用当前已含计费和摘要改动的工作区；创建干净工作树会丢失本次依赖的未提交集成状态，因此保持原分支，按文件差异审查，不混入提交。

## 原工作区验证记录（2026-11-16，迁移前）

- 7项新增模型范围 Go 测试及既有模型、连接、聊天生命周期、审查和摘要直接回归通过（SQLite；完整命令见 server/artifacts/multi-model-go.log 对应交接记录）。
- 管理后台 admin-page.test.tsx 20项通过；原生前端类型检查及两份受影响文件 oxlint 通过。
- 原生管理网页构建与 Linux amd64 服务编译通过（CGO_ENABLED=0，产物 server/artifacts/multi-model-server-linux；不是发布产物）。
- 导入源码完整性校验通过；翻译覆盖/准备测试2项通过；本次文件 git diff --check 通过。
- 本地 Ego 浏览器隔离预览确认全部/指定切换、多选过滤默认选项，截图 server/artifacts/multi-model-selected.png。模拟配置，不涉及正式策略保存。
- 独立审查发现 all 模式失效默认阻止额度保存；已观察新增回归失败并修复，审查复核无剩余确证问题。
- 桌面 managed-session 不转发模型选择，保留默认调用；未操作生产、未提交推送或公开发布。

后续验收：如需上线，分别构建目标环境网页/服务并部署；如需桌面切换，补齐 config 获取、主进程 model 转发与设置入口后再做隔离桌面验收。

## 主干迁移

从 origin/main 1440363 创建 codex/managed-multi-model-20261116，版本1.0.17。只迁移多模型字段、目录和调用校验；chatDigest 放入 model_policy.go，不带入旧工作区的摘要/支付业务，保留主干现有计费入口。独立审查发现 chat_test 中原有 malformed 预期被夹带，已恢复主干 uncertain 语义，并重新验证。源工作区其他未提交修改全部保留。

主干迁移验证：Go相关回归通过（SQLite，命令 `go test ./lingtu ./lingtuhost -run TestLingtu(ModelPolicy|ManagedModel|Connection|Chat|Review) -count=1 -timeout=180s`）；后台admin-page/admin-billing合计22项通过；原生前端类型、受影响文件lint、网页构建和Linux amd64编译通过；桌面1.0.17源码构建通过。来源校验和准备/翻译2项测试通过。后续PR云端状态单独核对。
