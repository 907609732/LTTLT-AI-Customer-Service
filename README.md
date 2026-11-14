# 灵兔 AI

Vue 3、TypeScript与Electron电商客服桌面工程，默认使用自己的模型Key，也可选择托管服务账号。实际功能与待验收项以[当前交接](docs/HANDOFF.md)为准。

工程根：`E:\~1awucheng\Plastic SCM\AI电商客服软件\client`。客户端、独立服务端、固定运行时和云端配置均位于此根。

## 从源码启动

```powershell
cd "E:\~1awucheng\Plastic SCM\AI电商客服软件\client"
# 首次安装或锁文件变化时执行 npm ci；依赖已就绪时直接启动。
npm start
```

开发模式：`npm run electron:dev`；浏览器预览：`npm run dev`。默认用户数据与平台登录继续保存在原路径，每次启动AI关闭，真实发送逐条确认。

## 维护入口

| 文档                                                             | 用途                           |
| ---------------------------------------------------------------- | ------------------------------ |
| [当前交接](docs/HANDOFF.md)                                      | 当前基线、功能缺口及下一步验收 |
| [AGENTS.md](AGENTS.md)                                           | 开发与验证规则                 |
| [目录边界](docs/PROJECT_LAYOUT.md)                               | 源码、生成文件、私有数据       |
| [项目约束](docs/CONSTRAINTS.md) / [架构](docs/ARCHITECTURE.md)   | 依赖、接口与安全边界           |
| [开发说明](docs/DEVELOPMENT.md) / [本地运维](docs/OPERATIONS.md) | 接入和故障排查                 |
| [打包](docs/PACKAGING.md)                                        | 云端产物及成品验收             |
| [整合记录](docs/parallel/INTEGRATION.md)                         | 八个功能领域的实际接线范围     |
| [日志与发送确认](docs/RUNTIME_LOGS.md)                           | AI状态、上下文调试及逐条批准   |

领域修改再读相应模块README、`docs/parallel`或托管服务文档。日常仅跑直接影响的检查；全量验证按AGENTS中的Release规则执行。许可证和上游来源文件必须保留。公开发布、生产部署和真实收费需要对应授权。
