# 2026-11-18 主干整合第一阶段：设备授权注册回跳

基线 `07a2ac6`（main 与 `codex/pdd-1067-integration-20261118` 同一提交），整合分支 `codex/main-consolidation-20261118`。整合方式固定为 `git merge --no-ff --no-commit a28750d`，保留 `codex/device-registration-redirect-20261117` 的真实父历史（base `377193d`，ahead=1）；本阶段结束时保持 merge 未提交，供 Codex 复核。

依据：`artifacts/main-integration-20261118/deepseek-audit-final.md`、`artifacts/main-integration-20261118/codex-review-notes.md`（后者纠正 stash 第三父漏检，并确认 `a28750d` 是唯一已完成但未进入主干的代码提交）。Git bundle 已 verify、8 个 dirty 树已备份；其他工作树、dirty 改动与 stash 全部只读保留。

## 任务、确切文件与针对验证

| #   | 任务                                             | 确切文件                                                                                                                                                                                                                                                                                                               | 针对验证                                                                                                    |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| T1  | 重放 redirect 功能网页补丁，不整提交 cherry-pick | `server/patches.json`：`web/src/features/auth/sign-up/components/sign-up-form.tsx` 追加 5 hunk；`web/src/features/auth/sign-in/index.tsx` 追加 `search={{ redirect }}` hunk；新增键 `web/src/features/auth/sign-up/index.tsx`、`web/src/routes/(auth)/sign-up.tsx`、`web/src/features/auth/hooks/use-auth-redirect.ts` | 结构化比对：合并结果包含 main 全部既有 hunk（0 丢失）与 `a28750d` 全部 redirect hunk（0 缺失）；JSON 可解析 |
| T2  | 纳入 3 个新增自有 auth 测试                      | `server/overlay/web/src/features/auth/hooks/__tests__/auth-redirect-navigation.test.ts`、`.../sign-up/__tests__/redirect.test.tsx`、`.../sign-up/components/__tests__/register-redirect.test.tsx`                                                                                                                      | 本阶段只做存在性/哈希登记；定向执行留待 Codex 复核后另派                                                    |
| T3  | 更新既有 admin 登录提示测试                      | `server/overlay/web/src/features/lingtu/admin-login-hint.test.tsx`                                                                                                                                                                                                                                                     | 同上；哈希写入来源清单                                                                                      |
| T4  | 来源清单与来源说明增量更新                       | `server/source-files.json`（4 个测试 + `patches.json` 实际哈希，其余条目与 `upstreamSha256` 保留）、`server/PROVENANCE.md`（追加来源与本轮范围）                                                                                                                                                                       | `npm run check:vendor`                                                                                      |
| T5  | 版本统一，不回退                                 | `package.json`、`package-lock.json`（一次性设为 1.0.68；拒绝 `a28750d` 的 1.0.47）                                                                                                                                                                                                                                     | `node -e JSON.parse` + `npx prettier --check`                                                               |
| T6  | 冲突文档保留当前内容并在顶部补本轮条目           | `docs/HANDOFF.md`、`docs/VALIDATION.md`、`docs/VERSIONING.md`（保留 main 当前全部记录）、`docs/parallel/DEVICE_REGISTRATION_REDIRECT.md`（原历史说明保留并标注“当时验证不是本轮证据”）                                                                                                                                 | `npx prettier --check`；无冲突标记                                                                          |
| T7  | 本轮记录                                         | `docs/MAIN_INTEGRATION_20261118.md`、本文件                                                                                                                                                                                                                                                                            | `npx prettier --check`                                                                                      |

`server/patches.json` 与 `server/source-files.json` 的合并由 Git 三方合并后逐项核对：不整文件选 ours/theirs，不 `git checkout --ours/--theirs` 覆盖整个文件，不丢真实 server auth 改动。

## 保留约束

- 只允许上述文件与 T7 两份文档进入结果；`vendor/**`、`electron/**`、`src/**` 现有代码、`.github`/CI、其他任务资料、`server` Go 业务与 `.upstream` 生成目录一律不改。
- 保留 main 当前成本/支付补丁、主图采集、PDD 实店修复、欢迎回执、调试 gate 与全部既有 guard。
- 不引入新依赖；不运行全量 `npm run check`、`npm run test:desktop`、上游或 Go 测试；不执行 server prepare；不 commit/push、不更新 main、不重启应用。
- 本阶段验证仅限：`git diff --check`、`npm run check:vendor`、改动自有文档与 package 的格式/解析检查。
- 结论必须区分“已进入候选树”与“已验收”：server auth 定向验证与真实浏览器注册回跳验收均未在本阶段执行。

## 收尾状态

冲突全部解决且暂存，merge 未提交；staged diff、合并父、允许文件清单与冲突处理说明写入 ignored `artifacts/main-integration-20261118/implementation-stage1.*`。

## P2 复核补正（2026-11-18，独立复核后）

复核确认一个 P2：`server/scripts/verify.ts` 的 `Native frontend tests` 只跑 `src/features/lingtu` 与 `src/features/auth/api.test.ts`，未执行本次三份新增 auth suite。补正范围严格限定：`server/scripts/verify.ts` 仅在既有 test 参数追加 3 份精确路径（`hooks/__tests__/auth-redirect-navigation.test.ts`、`sign-up/__tests__/redirect.test.tsx`、`sign-up/components/__tests__/register-redirect.test.tsx`），在既有 lint 参数追加 `sign-up/index.tsx`、`hooks/use-auth-redirect.ts`、`routes/(auth)/sign-up.tsx`；未扩大到全 auth，未改 Go/DB/deploy 步骤，未改 GitHub YAML。`sign-up/__tests__/redirect.test.tsx` 新增注册路由 `beforeLoad` 覆盖（已登录 + 内部设备目标；外部地址回退 `/dashboard`）；`register-redirect.test.tsx` 新增 `OAuthProviders.redirectTo` 与微信 `handleLoginResult(res.data, redirectTo)` 覆盖；`docs/parallel/DEVICE_REGISTRATION_REDIRECT.md` 历史 tsx 代码块按现有 Prettier 格式化（语义与历史结论不变）；`server/source-files.json` 与 `server/PROVENANCE.md` 更新实际 SHA256（redirect `3dd29e4778a01b337c8a4dcc3ed1fa780cca9f2dbde7c24f077c8968f3adabc6`，register `7bdf3c21fee4819d4b5e72bc8feb7bd599b86dda339283ccc4fd5e7ddcb8826d`）。

局部验证（隔离缓存 `E:\codex-builds\lingtu-main-integration-web-20261118`）：4 目标 suite 4 文件 9 项通过；既有 `auth-redirect.test.ts` 6 项通过；网页 typecheck（先跑 TanStack Generator）、变更范围 oxlint、oxfmt 与网页 build 通过。未运行完整 `server:verify`、根全量、native、上游或真实账号 E2E。

## 阶段进度（2026-11-18 收尾）

- [x] 冲突逐项解决并暂存（16 文件，merge 未提交）
- [x] Codex 独立结构/代码复核与独立审查：无剩余 P1/P2
- [x] P2 补正：CI 3 suite 接线 + 路由 `beforeLoad` / `SignUpForm` 关键断言
- [x] 局部验收：4 suite 9 项、sanitizer 6 项、prepare 2/2、typecheck/lint/oxfmt/build 0、root 15/15、`07a2ac6` baseline 8 fail / 7 pass
- [x] 提交真实两父 merge（`07a2ac6`、`a28750d`）
- [x] 5 个已证明 ref 的历史登记（`-s ours`，tree 零差异）
- [x] main fast-forward 推送，CI 按现有 main push 自动运行
- [ ] 正常启动与最终 docs-only 回执（Codex 随后执行）
