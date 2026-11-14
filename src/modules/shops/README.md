# shops 模块

职责：店铺、商品、配置同步与商品编辑界面。

公开入口：index.ts。跨模块必须从该入口引用，禁止访问 components 或 demo 的内部路径。

界面入口：ShopGoodsPanel、ShopsListPanel、GoodsListPanel、ShopDeskPanel、GoodsDetailDialog、GoodsEditDialog、GoodsLearnDialog、ShopSyncConfigDialog、ShopPicker、ShopHomeView、ShopHomePanel。

当前业务状态：ShopGoodsPanel、AddShopDialog 和 ShopHomePanel 已接本机店铺/商品知识与真实计数。旧 GoodsListPanel 等还原子组件未承担新的领域服务；真实 DTO 以共享 backend 契约为准。平台能力仍需实际店铺验收。

接入流程见根目录 docs/LOCAL_INTEGRATION.md。demo 是旧视图数据，不是 API DTO；新增能力在所属模块建立服务与类型，经过本地运行时契约，不直接访问 IPC、网络或文件系统。

数据看板沿用 ShopHomePanel 入口；dashboard.ts 负责真实快照的纯统计与汇总导出，局部 dashboard 样式恢复实时值守、概况、积压与风险区域。意图覆盖只统计明确绑定店铺的有效包，商品限定包不冒充整店覆盖。周期区只统计本机已采集保留记录，完整 AI 日报与平台售后明确未接入；不使用 demo 或引擎累计值伪装完整经营数据。

修改前阅读根目录 AGENTS.md 和 docs/CONSTRAINTS.md。修改后运行相关类型、构建、单元与桌面检查，并更新 docs/HANDOFF.md。

## 2026-11-14 店铺列表排版恢复

配置中心 shops 入口恢复 ShopsListPanel 横向店铺卡片，使用 runtime 真实快照，不再引用 demo。接通状态/平台/分组搜索与分页、添加、打开登录、分组保存、确认移除及按店导航至现有接待与商品功能。商品页新增返回列表入口，原编辑、CSV 预览导入/导出与服务接口保留。连接与登录认证分开显示，自动操作注明全局范围；平台自动学习与跨店同步缺少现有契约，明确未接入。

仅修改页面、路由注册、局部样式及相关测试；不新增依赖、IPC，不修改 vendor、数据目录或真实发送机制。使用 Node 24 和现有 Vue/Element Plus。旧 F 盘目录不存在，本轮实际工程为 E:/~1awucheng/Plastic SCM/AI电商客服软件/client。未提交的数据看板任务文件由另一任务维护。

## 商品知识管理优化（2026-11-14）

goods/desk现为独立单店商品知识页：双搜索、勾选当前页、逐条版本化批量修改/删除、独立商家编码、可选分页容量、CSV弹窗。平台采集/候选审核是真实入口；候选保存的意图包与本地商品行分开，enabled称启用/停用。merchantCode存在本账号目录product-codes按店哈希文件，CAS及原子写入，不改vendor；当前不进入模型检索索引、不随旧CSV或跨店同步导出。全店查询复用原始list-products分页，核对修订/总数后搜索，最多10000条。详情见docs/PRODUCT_KNOWLEDGE.md。
