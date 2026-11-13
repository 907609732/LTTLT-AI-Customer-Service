# shops 模块

职责：店铺、商品、配置同步与商品编辑界面。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：ShopGoodsPanel、ShopsListPanel、GoodsListPanel、ShopDeskPanel、GoodsDetailDialog、GoodsEditDialog、GoodsLearnDialog、ShopSyncConfigDialog、ShopPicker、ShopHomeView、ShopHomePanel。

当前业务状态：ShopGoodsPanel、AddShopDialog 和 ShopHomePanel 已接本机店铺/商品知识与真实计数。旧 GoodsListPanel 等还原子组件未承担新的领域服务；真实 DTO 以共享 backend 契约为准。平台能力仍需实际店铺验收。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。
