# account 模块

职责：登录、账号、团队及店铺登录弹窗。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：LoginView、ShopForgotPasswordView、AccountLoginPanel、AccountSettingsDialog、TeamPanel、CookieLoginDialog。

当前业务状态：本机模式无需软件账号；显式托管模式复用设备授权。TeamPanel 提供已有账号定向邀请/本人接受、角色管理、团队店铺登记与成员授权、操作审计，通过可注入 TeamService 调用独立服务端团队领域；未装配或本机模式明确不可用。平台账号密码自动填写未接入，不伪造平台登录。

团队契约和服务从 index.ts 导出；quality 通过公开 useTeamWorkspace 使用同一接口。服务端按团队和店铺校验最终权限，UI 权限只控制可操作状态。公共注册及 IPC 接入、测试与边界见 docs/parallel/team-handoff.md（不并发修改公共 HANDOFF）。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。
