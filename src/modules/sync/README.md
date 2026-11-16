# sync 模块

2026-11-16：按用户要求删除跨店同步页面、配置中心菜单及店铺卡同步入口。旧 `#/store-sync` 与 `panel=sync` 回到店铺列表。StoreSyncView及对应页面测试已删除。

保留同步契约、installStoreSyncClient、服务端IPC及本机历史备份/回滚服务，不删除任何已有店铺资料或备份。商品知识继续由知识库明确关联同款，价格库存按店铺/SKU单独维护。

当前公开入口 index.ts 仅导出契约和客户端安装方法；没有可见同步页面。跨模块仍通过公开入口引用。

服务维护见 electron/store-sync-service.ts、store-sync-ipc.ts 和 docs/parallel/store-sync-handoff.md。保留测试：store-sync.test.ts、store-sync-integration.test.ts、store-sync-ipc.test.ts。原生整合检查验证旧路由跳转及隔离服务备份，不再操作已删除页面。
