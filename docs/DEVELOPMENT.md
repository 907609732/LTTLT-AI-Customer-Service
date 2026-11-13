# 开发与功能接入

从 F:\Setupgod\yunduo-ui 主项目根执行命令；目录和当前授权范围先读 PROJECT_LAYOUT.md、AGENTS.md。云端构建配置在本工程 .github，本轮只整理本机文件，不提交或推送。

## 命令

```powershell
npm ci
npm run dev              # 浏览器预览
npm run electron:dev     # Vite + Electron
npm start                # 构建后启动桌面
npm run build
npm run typecheck
npm run lint
npm test
npm run test:desktop
```

第一次对接前请先读 CONSTRAINTS 和 HANDOFF。环境、下载与故障排查见 OPERATIONS。

## 当前功能接入基线

默认自带模型密钥模式，桌面本地后端已接线；用户可在设置中显式选择托管服务。先读 LOCAL_INTEGRATION.md、MANAGED_SERVICE.md 和 HANDOFF，不要把托管账号登录变成本机模式的使用前置条件。下一项业务验收由用户使用测试店铺和自己的模型凭证完成。

自动测试继续使用临时数据与本机模型夹具，不读取环境中的真实密钥，不连接真实店铺，不把夹具成功记作生产验收。

## 修改一个业务模块

1. 读模块 README，确认入口组件和公开导出。
2. 在模块定义真实业务契约与服务，明确数据来源和是否持久化。
3. 用服务返回值驱动页面，分离加载、草稿、确认值和失败状态。
4. 去掉该流程对应的占位提示，保留尚未接入能力的明确反馈。
5. 验证成功、失败、空结果、重复提交、退出和卸载后的行为。
6. 更新模块说明、HANDOFF 与必要的架构决策。

## 后续 AI 任务模板

```text
目标：实现哪一个可验证的业务流程。
先读：AGENTS.md、docs/CONSTRAINTS.md、docs/ARCHITECTURE.md、docs/HANDOFF.md、模块 README。
接口资料：真实接口、权限、错误码、数据样例和测试环境。
范围：允许修改的模块、需要保持兼容的行为、不在本次实现的功能。
验收：用户能完成的操作、失败处理和必须通过的检查。
交接：实现结果、验证证据、剩余能力、下一项任务。
```
