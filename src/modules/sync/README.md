# sync 模块

2026-11-16：按用户要求删除跨店同步页面、配置中心菜单及店铺卡同步入口。旧 `#/store-sync` 与 `panel=sync` 回到店铺列表。StoreSyncView及对应页面测试已删除。

2026-11-17：前端 `installStoreSyncClient`/`getStoreSyncClient` 注册器已删除（无消费者）。`app/main.ts` 不再创建或安装同步客户端；模块 `index.ts` 只保留 `shared/contracts/store-sync` 的 reexport。跨店同步的共享契约、`shared/platform/store-sync.ts`、preload/主进程固定 IPC、本机同步/备份/回滚服务及其测试全部保留，不删除任何已有店铺资料或备份。

当前没有可见同步页面或前端调用方；商品知识继续由知识库明确关联同款，价格库存按店铺/SKU单独维护。跨模块仍通过公开入口引用契约。

服务维护见 electron/store-sync-service.ts、store-sync-ipc.ts 和 docs/parallel/store-sync-handoff.md（仅有历史状态，无当前界面）。保留测试：store-sync.test.ts、store-sync-integration.test.ts、store-sync-ipc.test.ts（client 契约由该测试直接使用 `shared/platform/store-sync.ts`）。原生整合检查验证旧路由跳转及隔离服务备份，不再操作已删除页面。
