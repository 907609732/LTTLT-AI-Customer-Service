# 云端构建配置

本目录属于 F:\Setupgod\yunduo-ui 主工程。未来作为独立仓库使用时，.github、package.json、src 和 electron 位于同一层级；工作流不再进入外层仓库的 yunduo-ui 子目录。

workflows/lingtu-ai-desktop.yml 支持手动运行、Pull Request 和 main 推送触发；在 Windows 上安装锁定依赖，执行项目检查、真实桌面验收、安装包/ZIP 构建及打包后 EXE 验收。产物、源码提交清单、SHA256 和测试证据保存在该次 Actions 的 Artifacts，保留 30 天。下载说明见 ../docs/PACKAGING.md。

默认只读 contents 权限，没有 gh release、写入令牌、自动发布或固定旧分支名。不要在这里填入仓库账号、服务端管理员密码或模型 Key。配置已收回本主项目，用户最新授权本轮分支推送与 main 合并；据此触发检查与 Artifacts 构建，不公开发布安装包。
