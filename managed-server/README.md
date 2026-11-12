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

## 管理界面与用量口径

管理页提供概览、模型配置、账号管理、用量记录、登录方式和试用设置，默认中文，可切换英文。语言偏好与模型密钥分开处理，未保存的密钥只保留在当前页面内存。

账号列表包含所有未删除的注册账号，尚未获得客户端授权的账号也会展示。查看列表不会创建额度；管理员明确保存授权后才更新额度与期限，调整保留安全验证、原因和审计。

用量记录仅统计托管客户端请求，模型配置页的连接检测不计入。按账号汇总输入、输出、总词元和调用结果，并可查看单次明细。只有厂商原始响应明确返回的完整整数用量才计入已知词元；未返回或旧记录来源不明时单独显示未知用量，不能把它理解为零消耗。统计覆盖当前数据库保留的全部历史，分页只限制展示条数。

## 图片识别（开发分支）

新增独立 `qwen-vision` 渠道，固定模型 `qwen3-vl-plus`，沿用百炼北京 OpenAI 兼容接口。管理员在“模型配置 → Qwen3-VL · 图片识别”中显式保存并测试凭据，再将该模型设为默认或分配给指定账号；不复用或复制其他渠道的 Key。普通客户端从 `/me.capabilities` 读取支持状态，未配置/未启用的渠道不会宣称支持图片。

客户端还需在“图片识别”页为本店显式开启。请求只允许 user 消息中的 text/image_url parts，每轮总计最多4张；图片是公网 HTTPS 域名链接，不允许内嵌文件、IP、内网名字、用户凭据或非标准端口。服务端不下载或转存图片，图片由模型厂商读取。模型的图片格式/单张大小限制仍适用，参考[官方多模态兼容协议](https://help.aliyun.com/en/model-studio/qwen-vl-compatible-with-openai)。

图片继续使用原有请求摘要、试用占用、结果缓存与未知结果保护；相同请求标识及相同图片只调用一次，改变图片却复用标识会被拒绝。文字模型收到图像请求时在占用额度前拒绝。客户端识图不支持/失败时转当前会话人工，其他会话和店铺不受影响；不会把链接当成图片内容猜测。

此变更需要服务端与客户端同步更新。旧服务端不会返回能力声明，因此新客户端不会错误开启托管识图。当前分支尚未部署到正式双端入口，也未使用真实厂商凭据或真实买家照片做自动测试。
