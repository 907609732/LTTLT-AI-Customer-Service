# settings 模块

职责：登录、回复间隔与高级模型配置。公开入口为 index.ts。

顶栏唯一 LoginDialog 登录入口复用 Element Plus、model-presets 与 runtime.run。自己的 Key 连接验证成功后保存；错误保留输入，关闭清空草稿。服务端采用已有浏览器设备授权，明确取消才停止授权；登录成功经 activate-model-source 安全切换工作区后关闭，失败不冒充可用。账号名、剩余次数、切换账号与退出保留。

SettingsView 默认显示回复间隔（0～3600 整数秒），模型自定义配置折叠；ModelSourceSettings 仅承担必要异常核对，不再暴露来源地址或管理后台。组件不访问网络、持久化或 Electron，密钥由主进程加密保存。

验证：tests/simple-login.test.ts 覆盖设置简化、Key失败保留、成功关闭、关闭不取消授权及授权后的工作区切换。真实账号与模型调用未由夹具测试证明。GeneralPanel 保留旧还原视图，未接线。
