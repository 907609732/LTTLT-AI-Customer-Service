# 灵兔 AI 项目 · 独立托管服务端

这里保存 PR #21 的托管服务端和原生管理网页，来源及许可见 PROVENANCE.md，运行边界见 CONSTRAINTS.md。桌面 Vue 界面没有被 React 工程替换。原始说明见 README.upstream.md。

目录：overlay 为服务端/管理网页覆盖层，patches.json 为固定上游锚点补丁，upstream.lock.json 为版本锁，deploy 为既有 Linux 部署参考，scripts 为准备与验证入口，tests 为生成结果检查。.upstream、bin、artifacts、runtime 均为本机生成或私有目录，不提交。

## 准备与验证

要求 Node.js >=24、Go（自动选择 go.mod 的 1.26.10 工具链）、gofmt、Bun **1.4.4**。不要降低原生依赖版本来迁就机器环境。若本机 Bun 不是该版本，可通过 YUNDUO_SERVER_BUN 指向独立的 1.4.4 可执行文件，不需要替换全局工具。

在项目根目录执行：

```powershell
npm run server:prepare
# 如需指定独立 Bun：$env:YUNDUO_SERVER_BUN = '独立安装目录/bun.exe'
npm run server:verify
```

verify 会依次重新准备固定源码、运行 9 个目标 Go 包的 SQLite 回归、冻结锁文件安装网页依赖、检查翻译覆盖、生成路由、检查原生网页类型和改动范围 lint、运行托管/认证前端测试、构建网页和 Linux amd64 服务。验证过程不运行 deploy/bootstrap-private.py，不接触生产数据库和密钥。

Windows 避免把 Bun 依赖放在 EFS 加密目录或跨盘目录连接中。可用 YUNDUO_SERVER_BUILD_DIR 指定独立、未加密的物理构建缓存目录，并用 BUN_INSTALL_CACHE_DIR 指定同盘的包缓存。工具复制固定源码到该目录做原生网页检查，最终 dist 和二进制仍回写 server。只能使用专用可再生目录，不要指向现有业务目录；两个变量都不是生产运行配置。验证器会将选定 Bun 的目录加入子进程 PATH，避免脚本误调用旧版全局 Bun。

若机器 GOSUMDB=off，验证子进程恢复 sum.golang.org 以校验 Go 工具链下载，不改变全局配置。默认本机测试没有 -race，也不声称运行 MySQL/PostgreSQL；需要隔离数据库后按源工作流另做矩阵验证。

结果：server/artifacts/verification.json；Linux 二进制及许可：server/bin/；管理网页：server/.upstream/web/dist/。原生网页 API 来源默认 https://api-kefu.lttlt.top；部署到其他域名时，构建前明确设置 VITE_MANAGED_API_ORIGIN 并同步核对服务端来源与 cookie 配置。

## 运行与数据

### 本机 Windows HTTP 预览

用户明确要求无需证书的本机 HTTP：启动入口为项目根目录 `npm run server:start`。它运行 `server/bin/lingtu-managed.exe`，仅监听 `127.0.0.1:3000`，原生管理网页与 API 同源，后台地址 http://127.0.0.1:3000/lingtu/admin 。不生成或导入证书，不使用生产数据库。

首次启动在 `server/runtime/local-http/` 创建独立 SQLite、随机管理员密码、主密钥及会话密钥；`private.json` 保存本机启动信息，Windows ACL 限制当前用户与 SYSTEM。重复启动保留账号和数据，不重置密码。该目录全部忽略提交，备份必须同时包含数据库与密钥；密码不写到日志。日志为 stdout.log/stderr.log，进程号为 server.pid。

HTTP 通过显式 LINGTU_LOCAL_HTTP=1 启用，只接受相同的数字回环 API/portal 来源与回环监听；请求还校验真实 peer、Host、浏览器 Origin。不能用该模式部署公网。桌面设置允许带端口的 http://127.0.0.1，其他 HTTP 地址拒绝。

Windows 可执行文件构建：在 `.upstream` 内设置 GOOS=windows、GOARCH=amd64、CGO_ENABLED=0，然后 `go build -trimpath -o ../bin/lingtu-managed.exe .`。构建前把原生管理网页的 VITE_MANAGED_API_ORIGIN 设置为 http://127.0.0.1:3000 并构建，结果复制到 `.upstream/web/dist`，再编译 Go；网页地址在构建时固定。Linux 产物不会因为本机 Windows 重编译而自动更新。

本机 Go 缓存所在盘空间不足时，通过当前构建子进程的 GOCACHE/GOTMPDIR 指定有空间的专用目录，不删除用户其他项目文件、不改全局设置。

Linux 部署参考 deploy/，其中路径、服务名和域名保留上游值，不能不检查就覆盖现有服务。运行前必须独立配置数据库、32 字节主密钥、至少 32 字符的会话密钥、HTTPS API/账号网站来源和受限反向代理。数据库和主密钥一起备份。首次管理员初始化仅在私有入口进行。

这里没有生产数据库、SMTP 密码、模型 Key 或可用管理员密码。构建通过不代表已发布。客户端在设置中选择本机 Key 或托管服务；默认仍为本机，托管登录使用浏览器设备授权，不向桌面下发服务商 Key。详细使用、切换和回退说明见根 docs/MANAGED_SERVICE.md。
