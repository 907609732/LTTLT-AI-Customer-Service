# sync 模块

职责：本机同一账号工作区内跨店复制商品知识与接待配置，提供源/目标选择、显式范围、冲突预览、确认、备份和回滚。

公开入口 `index.ts`：`StoreSyncView`、`installStoreSyncClient`、同步契约。共享 IPC/DTO 契约位于 `src/shared/contracts/store-sync.ts`，模块 contracts.ts 仅重新导出。组件仅调用模块服务和公共运行时状态，不直接使用 Electron、网络或文件。

app 先用共享平台工厂 `createStoreSyncClient(invoke, getWorkspaceId)` 创建窄客户端，然后 `installStoreSyncClient(client)`，最后装载 `StoreSyncView`。未安装客户端时页面明确不可保存。独立建议路由 `#/store-sync`；本模块不修改原商品/店铺/接待组件。

商品必须明确选择编号，按目标同 productId 冲突；不会推测跨平台 SKU 映射。配置范围为文字欢迎、识图开关、本店人工关键词。默认冲突跳过，覆盖需要重新预览及勾选确认。全局规则、意图包、模型、凭据、买家资料、AI 开关和平台业务动作不在同步范围。

主进程 `electron/store-sync-service.ts` 只经原 backend 命令读写业务，单独保存 recovery journal；`store-sync-ipc.ts` 每次解析工作区 envelope 并检查当前服务。公共接线、互斥和生命周期要求详见 `docs/parallel/store-sync-handoff.md`。未完成公共接线不能声称桌面功能已可用。

针对性测试：`tests/store-sync.test.ts`、`store-sync-integration.test.ts`、`store-sync-ipc.test.ts`、`store-sync-view.test.ts`。上游集成只使用临时目录、合成店铺和资料，不连接平台或付费模型。
