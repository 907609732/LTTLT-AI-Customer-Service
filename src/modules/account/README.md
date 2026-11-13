# account 模块

职责：登录、账号、团队及店铺登录弹窗。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：LoginView、ShopForgotPasswordView、AccountLoginPanel、AccountSettingsDialog、TeamPanel、CookieLoginDialog。

当前业务状态：当前无需软件账号。LoginView 提供进入本机工作台入口；软件账号、团队授权及平台账号密码自动填写仍未接入，不要伪造登录。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。
