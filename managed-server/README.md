# 灵兔托管模型服务

本目录在 New API v1.0.0-rc.49（固定提交见 upstream.lock.json）上维护最小可重建覆盖层。上游项目：<https://github.com/QuantumNous/new-api>，AGPL-3.0-or-later；保留上游 LICENSE、界面归属及对应源码入口。修改源码：<https://github.com/907609732/LTTLT-AI-Customer-Service>，开发分支 `codex/managed-model-access`。

## 构建

需要 Node.js 24、Go 1.26.10 或更新版本、Bun 1.4.4。仓库根目录执行：

```powershell
node scripts/prepare-managed-server.mjs
go -C managed-server/.upstream test ./lingtu ./lingtuhost -count=1
```

随后在 `managed-server/.upstream/web` 执行 `bun install --frozen-lockfile`、生成 TanStack 路由、`bun run typecheck`、`bun run test src/features/lingtu src/features/auth/api.test.ts`、`bun run build`；在 `.upstream` 执行 `go build .`。完整可重现命令和三种实际数据库测试见 `.github/workflows/managed-server.yml`。`.upstream` 是生成目录，不提交依赖或构建产物。

## 运行约束

- 独立数据库、独立发布目录和备份，API 仅监听回环地址，外部经 HTTPS 反向代理。
- `LINGTU_API_ORIGIN`、`LINGTU_PORTAL_ORIGIN` 是固定 HTTPS 来源；会话 cookie 必须安全且受信来源明确，不允许通配 CORS。
- `LINGTU_MASTER_KEY_FILE` 指向权限 0600 的独立 32 字节主密钥文件；`SESSION_SECRET` 至少 32 字符。密钥必须随数据库一并独立备份，不能提交仓库。
- 首次管理员初始化仅通过 SSH 隧道私有入口进行。公网代理阻止初始化接口；完成初始化并配置 SMTP / 登录应用 / 模型后再开放注册。
- 模型 Key、OAuth Secret、SMTP 凭据和短期结果缓存加密保存；日志与使用记录不记录客户消息正文。
- 原生管理员模型额度与客户端按次数试用账本分离；客户端专用受信调用只使用被固定的渠道，禁止普通账号通过原生令牌入口绕过试用限制。
- 不明确的上游结果保留占用，后台核实后才确认消费或退款；后台对账不会重发模型请求。

默认试用每身份 20 次 / 7 天；每日全局 200 次、每账号并发 1、每分钟 5 次、全局并发 4、每次输出最多 512 token。后台可调整。上述默认值不代表已配置真实厂商凭据或已完成线上验收。

前端同次构建部署到大陆与海外入口，均调用同一大陆 HTTPS 后端，数据库与登录状态不复制成静态快照。安装器等大文件走 GitHub Releases，服务端不提供大文件镜像。
