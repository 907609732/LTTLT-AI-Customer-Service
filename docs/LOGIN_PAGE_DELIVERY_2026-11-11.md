# 登录确认页发布记录（2026-11-11）

## 大陆已上线

- 页面：https://account-kefu.lttlt.top/lingtu/device
- 修复白色卡片继承深色主题浅色文字；复用现有局部浅色主题，确认码使用 24px 深色文字，加深安全提示。
- 当前账号旁新增“切换账号”：复用原生 logout 和认证缓存清理；成功后跳转登录，回跳地址携带当前编辑的确认码；退出失败保留当前账号并提示错误；不会自动批准设备授权。
- 源码提交：`31718e29d4cf50915115d7b72315e08f34a0d525`，分支 `codex/managed-model-access`。
- GitHub Actions：`42976189927`。前端检查、构建及 SQLite/MySQL/PostgreSQL 三组回归全部成功。
- 本地登录页与后台回归 12 项通过，翻译生成检查 2 项通过，类型检查及定向 Lint 通过。Windows 原路径触发 Vitest 初始化文件解析问题；测试通过复制源码至本机临时目录、复用现有依赖完成，没有修改业务运行环境。

## 发布与验收

- 使用上述 Actions 的同次 `managed-web-31718e29d4cf50915115d7b72315e08f34a0d525` 产物，下载 ZIP SHA256：`fe2048605809faf6468081e7035ae538f3775e50f40ef98544919582b85a055c`。
- 当前目录：`/opt/lingtu-kefu/current -> /opt/lingtu-kefu/releases/31718e2-web`。
- 前端 index.html SHA256：`caf442888bf2718257c26b5443cd89898df367f8beafd8827f4faceb6a760a96`，本地、服务器和公开 HTTPS 返回文件一致。
- 原后端继续来自 `/opt/lingtu-kefu/releases/daee6f6/server`；二进制 SHA256 保持 `ecd14c5c466f7acb17444f335b1798a7f9b166983a81a035069d33ff96f7656c`。
- 仅切换网页目录，后端 PID `1779184` 未变；API 健康检查成功。数据库、主密钥、运行配置和 DNS 均未修改。
- 新发布目录保留旧网页的哈希资源，避免已打开页面的延迟加载资源失效；旧发布目录完整保留。回滚目标为 `/opt/lingtu-kefu/releases/daee6f6`，通过原子替换 current 软链接恢复。
- 正式浏览器验收：全局深色主题下标题、账号、标签、确认码均为深色；确认码 24px；“切换账号”按钮显示。浅色主题、375px 手机宽度下文字清晰，无横向溢出。
- 未点击真实账号的退出或设备授权按钮；账号切换成功、失败和不自动授权行为由接口适配器回归验证，未声称完成两个真实账号之间的登录验收。

## 境外尚未同步

- 原站点 `appgprj_6af182ede38c81919ad09d70fd41e93a`，入口 https://lingtu-kefu-account.flutedaura2.chatgpt.site ，仍保持旧版和既有访问权限。
- Sites `get_site` 能读取该站点，但 `create_source_repository_write_credential` 返回 `NOT_FOUND / Sites project not found`；当前账号站点列表不含该站点。未创建替代站点、改变权限或覆盖其他项目。
- 原 Sites 源码工作区 `../managed-account-portal-site` 未修改。恢复原站点编辑权限后，应继续使用上述同次 Actions 前端产物同步；不能将大陆上线视为双端同步完成。
- 本次未修改自定义域名线路和 TLS，既有境外分线路及 Sites 自定义 TLS 未验收状态不变。
