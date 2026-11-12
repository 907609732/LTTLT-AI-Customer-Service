# 源码诊断控制台

用户目标：源码运行时有可见控制台，实时输出日志和当前接待状态，方便定位不回复问题。

方案（用户已选择独立终端）：npm start / npm run dev 默认打开 Windows Terminal 独立窗口，由 PowerShell 运行源码并显示 stdout/stderr。复用官方终端和现有 Logger；终端安装在用户程序目录，项目不包含终端二进制。--no-console 留在当前终端，--console-child 防重复开窗。不改执行策略。关闭终端可能同时结束源码程序，退出程序后终端保留便于复制日志。

复用现有 Logger、ReplyEngine.status、店铺连接信息；只在未打包且 --source-diagnostics 模式启用详细日志。状态变化输出，30秒心跳，显示店铺连接、AI、处理中数量、成功/失败/限速、人工接管和全局异常码；状态摘要不输出账号凭据、Key或会话正文。正式安装版不启用。保持启动AI默认关闭。

实施：
1. 先写源码终端参数转义与重复启动保护和诊断状态去重、心跳、关闭清理的单元测试，验证红测。
2. 增加 scripts/source-console.mjs；源码启动脚本传 --source-diagnostics。
3. 增加 electron/source-diagnostics.cjs，接入 backend 的现有状态及日志，main 限定源码模式；增加生成/发送阶段的诊断日志。
4. 运行类型、单元、引擎、构建和Electron集成检查。用隔离数据验证控制台，再启动用户实际源码窗口。测试不向真实买家发消息。
5. 复核并更新现有 PR #16；不合并、不发布。

参考：Node child_process、Microsoft Windows Terminal 官方文档；现有依赖已覆盖需求。
