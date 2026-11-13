# 来源与本地适配

- 来源仓库：https://github.com/907609732/LTTLT-AI-Customer-Service
- 分支：codex/managed-admin-real-ui-20261113；PR #21。
- 固定提交：fd45e3832f3cceefefa64f8ff43d05da2cffe5e9。
- 导入范围：原 managed-server 整个目录，以及原 scripts/prepare-managed-server.mjs；不导入其 React 桌面应用或覆盖云朵 Vue 前端。
- 原 README 保存在 README.upstream.md，原项目许可保存在 LICENSE-LTTLT。New API 的固定提交、许可及完整源码由 upstream.lock.json 和 .upstream/LICENSE 保留；发布二进制附带原生许可。
- source-files.json 保存导入文件的 SHA256。准备脚本的唯一适配是把目录定位改为当前 server，使其可独立准备；原始摘要与实际摘要均已登记。
- root 的 check:vendor 同时检查本目录导入文件。原生 Go/React/已有 JS 属于保留来源的导入例外，不用桌面 TypeScript 检查冒充原生测试。
- 本地新增 verify.ts 是运维编排，用 Node.js >=24 的 TypeScript 支持执行，另由 tsconfig.server-tools.json 和根 ESLint 检查；不是服务端业务补丁。

桌面只复用已有 managed-session 协议，自有 TypeScript 控制器负责模式、账号隔离、受控操作及提交诊断。vendor/backend.cjs 仅新增可选 traceId 向 managedChat 的本机 options 转发，不进入请求正文；双哈希记录仍在 vendor/source-files.json。服务端 Go/API 逻辑未因本次导入而修改。

上游部署记录、真实供应商配置、GitHub CI 历史不能当作本机验证结果。当前本机验证及明确未测范围见根 docs/MANAGED_SERVICE.md 与 VALIDATION.md。

2026-11-14 本机启动修订：用户明确要求 HTTP、无需证书。routes.go 的来源检查转入新增 local_http.go，并只为显式回环模式安装 peer/Host/Origin 守卫；新增 local_http_test.go 验证边界。patches.json 在此模式跳过远程 HTTPS CORS，中间件仍拒绝跨来源请求。两处导入文件保留 upstreamSha256 与实际 sha256；start-local.ps1 是新增本机运维入口，不是上游文件。远程 HTTPS 逻辑与生产部署入口保持原有约束。
