# shops 模块

职责：店铺、商品、配置同步与商品编辑界面。

基础设置现为六步整页店铺信息助手：客服风格/物流/发货/售后/摘要，由setup-store管理当前工作区草稿，setup-rules复用模型方案命令保存为本店专用规则，保留其他店铺/全局及原字数上限。关闭暂存本次未保存内容，保存后回读；具体范围及限制见docs/SHOP_SETUP_WIZARD.md。

店铺工作台侧栏使用`StoreSidebarCard`，整行打开工作台，AI开关独立操作，右键基础设置/导入知识/店铺设置/店铺后台/关闭；导入知识和店铺设置当前仅提示预留。`ShopSetupGuide`与`useShopSetupStore`通过公开入口导出，由App全局装配；新增店铺成功自动引导，配置页可继续。引导不自动开启AI、不将访问配置页视为已配置。详见`docs/SHOP_SIDEBAR_SETUP.md`。

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

goods/desk现为独立单店商品知识页：双搜索、勾选当前页、逐条版本化批量修改/删除、平台商家编码只读、可选分页容量、CSV弹窗。移除大标题和店铺选择行，返回按钮在内容顶栏；采集按钮紧邻新增按钮左侧，直接启动任务并显示进度及错误，终态刷新列表。商品来源新增停用本地商品、已有平台编号跳过，问答候选及审核意图包仍独立，enabled称启用/停用。平台编码和SKU资料由账号/店铺隔离的platform-products原子档案提供；全店查询复用原始list-products分页，核对修订/总数后搜索，最多10000条。详情见docs/PRODUCT_KNOWLEDGE.md。

平台详情/SKU补充后，商家编码列只读使用platform-products来源档案，旧本机设编码入口移除，原product-codes档案保留。PlatformProductDetailsDialog展示详情、属性、图片来源及独立SKU编码/ID/条形码/价格/库存；未提供不代填。商品启用说明明确检索用途；重新采集更新平台来源，不覆盖手工知识或启用状态。CSV和跨店同步仍只支持原商品知识结构，不冒称已包含平台来源档案。
