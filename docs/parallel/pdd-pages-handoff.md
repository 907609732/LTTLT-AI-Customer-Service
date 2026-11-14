# 拼多多非空售后与工单分页交接

日期：2026-11-14。本任务实际根为 `E:/~1awucheng/Plastic SCM/AI电商客服软件/client`；文档中的旧 F: 路径未沿用。

## 现有成果与本次修改

接手时工作区已有非空售后解析、原生详情编号观察、查询 monitor、串行分页及计划文档。已有文件保持原样，未将这些功能作为本次新增成果。已读取 AGENTS、CONSTRAINTS、ARCHITECTURE、HANDOFF、LOCAL_INTEGRATION、ASSIST_BROWSER、ASSIST_CENTER 与分页计划。

本次仅修改：

- `electron/assist-platform-reader.ts`：每条原生详情观察返回后，先重新核对取消信号、来源、验证码、登录与店铺身份，再缓存详情映射及读取后续行。修复取消期间仍缓存晚到编号、切店后继续缓存后续行的问题。
- `tests/assist-reader-pages.test.ts`：增加取消与详情读取期间切店的两条回归，验证不缓存晚到结果、不继续第二行。两条测试在修复前按预期失败，修复后通过。
- 本独立交接文件；未修改公共装配、契约或 HANDOFF。

## 复用选择

保留项目已有 host、collector、reader 和 Electron Session WebRequest。无新增依赖、IPC、环境变量或持久化。

已检索成熟方案并核对官方来源：[Electron 源项目与 MIT 许可](https://github.com/electron/electron)、[WebRequest 官方实现说明](https://github.com/electron/electron/blob/main/docs/api/web-request.md)。现有原生 observer 与当前 Electron 技术栈一致，接入成本最低，不引入另一套浏览器或私有平台 HTTP API。官方提醒每事件只使用最后注册的 listener；当前 monitor 已按 Session 去重，后续接入其他网络观察者须统一管理，不可抢占这些 listener。

## 本次实际验证

1. `npx vitest run tests/platform-items.test.ts tests/platform-items-reader.test.ts tests/platform-items-pdd.test.ts tests/platform-items-collector.test.ts tests/pdd-pages.test.ts tests/assist-reader-pages.test.ts tests/assist-platform-query.test.ts --maxWorkers=1 --minWorkers=1`：7 文件、50 测试通过。
2. `npx tsc -p tsconfig.electron.json --noEmit`：退出 0。
3. `npx eslint electron/assist-platform-reader.ts tests/assist-reader-pages.test.ts`：退出 0。
4. 用已有 esbuild 将 `electron/assist-pages-check.ts` 单独构建到忽略目录 `artifacts/assist-pages/parallel-check.cjs`，以 Electron 43.8.9 运行：从中间页回首页，读取3页、5个唯一事项、4次只读查询，退款动作0次，通过。机器环境含 ELECTRON_RUN_AS_NODE，正式运行通过 Node spawn 删除子进程该变量；未修改系统环境。证据 `artifacts/assist-pages/report.json` 已刷新。本次构建未覆盖共享 dist-electron。

首次测试未限制 worker，遇 Windows Temp 文件 EBUSY，只有5文件39项实际完成；该次不算通过。单 worker 复跑全部上述7文件后通过。原生运行有 WSALookupServiceBegin 10108 网络枚举警告，隔离回环检查与断言均通过。

## 实店验收限制

本次通过 CUA 清点到“工作台 · 灵兔 AI”窗口，但绑定该窗口的截图实际显示聊天页面，与窗口 AX/标题不一致。未对该窗口点击或输入，避免误操作；未重启共享应用、未争用平台会话、未尝试验证码。故本次没有新增实店验收结论。

既有文档记录的实店待处理工单1条、待商家售后0条、其他筛选非空售后2条以及全部工单分页属于接手前记录，本次未重新验证。仍须在可正确定位的当前采集窗口只读核对：非空待商家处理售后、生产待处理多页聚合、售后详情完整落地页；空待办不能证明这些场景成功。不得把隔离数据视为实店成功。

## 统筹接入与后续条件

此次为现有 reader 内部修复，无新导出、注册、IPC、路由或公共装配需求。`createAssistPlatformReader` 签名保持不变；现有 local-runtime 接线继续使用即可。生命周期取消沿用既有 AbortSignal 和 collector/host 销毁机制。

未提交、推送、切分支、合并、发布、打包 Release 或部署；未执行真实发送、退款、举证或扣费。未做全量测试。

## 继续只读实店复验（2026-11-14 16:18～16:30，中国时间）

### 窗口定位恢复与操作边界

改用 computer-use 技能的 `@oai/sky`：从 `list_windows()` 返回对象选择明确窗口，再 `activate_window()`、截图与 AX 交叉核对。主窗口句柄 345908824、平台窗口句柄 38408896 在本次会话中可准确操作；平台窗口标题随导航从工单管理变为售后工作台、拼多多商家后台，选择时按已返回窗口对象恢复，不依据过时标题猜测新窗口。

截图证实此前不一致与窗口前台/遮挡有关，未发现需要改业务源码的证据。AX 在异步加载、滚动后会短暂保留旧标题、旧列表与旧坐标；发生过越界点击及“落到非目标窗口”的工具拒绝，拒绝后重新观察，没有向其他窗口输入。可见平台操作改用最新截图位置，并在加载后再次核对。辅助浮窗仍可能被主窗口/平台遮挡：尝试原生激活、Raise 和系统移动恢复后，其截图仍出现遮挡，不能宣称整个桌面截图库已修复。平台窗口的本次只读验证已完成，不依赖被遮挡浮窗的坐标操作。

没有点击同意退款、同意退货、联系消费者、发送、批量操作、举证、添加备注、付费、安装或验证码。没有读取 Cookie、密码或请求头；没有导出客户明细。截图/AX 证据在本聊天工具记录中；独立磁盘证据仅保存脱敏统计，不持久化订单号、售后号、物流单号或收货信息。

### 本次实际观察

- 店铺：平台顶部名称与本机已有店铺一致。后台复用了现有登录，没有重新登录或要求验证码。
- 辅助中心首次打开显示平台工单1条、售后0条；工单问题、待处理状态、关联订单及剩余时间与工单管理页面一致，后续自动同步时间与倒计时仍更新。
- 工单生产范围：待处理、近60天内（2026-09-15～2026-11-14），结果1条。
- 平台分页范围：手动切为全部、近60天内，点击查询后总数57。顺序点击1～6页，各页记录变化；前5页各10行，末页7行，合计57，末页6高亮且右箭头灰色。验证的是平台实际分页控件和实页数据，不是新启动采集器自动聚合57条，也没有按订单号去重（不同工单允许关联同一订单）。生产仍只收待处理事项，未将已完结记录写为待办。
- 非空售后：近3个月（2026-08-14 00:00:00～2026-11-14 23:59:59），“待买家处理”2条，列表共有2条；退款金额与实收金额已在本机逐项核对，真实金额不纳入源码交付。两条均已发货、退货退款、待消费者寄货，原因分别其他原因/不想要了，申请时间与剩余消费者处理时间均有显示。只读结构验证，不作为商家待办。
- 第一条“查看详情”实际落地至售后详情，页面显示独立售后编号、退款金额与列表一致、待消费者寄出退货，并与该列表行关联订单对应；售后编号与订单号不同。只观察状态，未执行页面任何处理按钮。详情已成功落地这一项补齐了此前未验收点；没有宣称两条详情均已打开，也未保存真实编号到交接。
- 商家待办：选中“待商家处理0”后，真实列表为全部(0)、暂无售后单、共有0条，日期范围同上。当前没有非空待商家处理样本，也没有多页待处理工单；这两项无法用当下数据完成实店自动采集验收，仍须等待对应真实样本。

### 实店发现的查询行为与局部修复

在售后已选中待商家处理时，再点击高级查询“查询”，平台会取消快捷筛选并返回全部售后（本次实际看到全部265条）；再次点击待商家处理后恢复0条。原 reader 的筛选核对会拒绝这些全部记录，未造成错误待办，但导致刷新失败。

本次新增修改 `electron/assist-platform-host.ts`：复用原 `queries.run` 等待第一轮原生请求完成；售后查询后检查快捷筛选是否仍选中，如果被清除，最多再执行一次既有 `clickPddQuery` 重新选中待商家处理，并等待该次请求完成。沿用 AbortSignal、验证码与原 collector 身份校验，不增加 IPC、私有 API、依赖或公共装配。第二次仍不能识别由现有 reader 拒绝，不采用全部数据。

`tests/platform-items.test.ts` 新增真实 DOM + 原生请求事件夹具回归：查询清掉快捷筛选，第二次点击恢复筛选；要求最终 reader 可识别商家0条且两次请求均完成。修复前测试失败（recognized=false、total=null），修复后通过。

本次复验确认了平台“查询→清筛选→重选→空列表”的行为；没有重启共享桌面或向运行中的主进程注入新代码，因此不把手工重选表述为新补丁已在实店自动执行。其他并行任务曾更新共享 dist-electron，本次未覆盖该目录；统筹下次正常重启构建后可继续验收自动刷新。

### 更新后的增量验证与交付

- 同上7个测试文件，单worker：51项通过。
- `npx tsc -p tsconfig.electron.json --noEmit`：退出0。
- `npx eslint electron/assist-platform-host.ts tests/platform-items.test.ts`：退出0。
- 只对上述两个本次修改文件运行 Prettier，未全目录格式化。
- 原生3页隔离检查属于上一节已验证结果，本次未重复运行或冒充新增实店证据。

本轮新增文件修改范围：host、platform-items测试及本独立交接；上一轮 reader与reader-pages测试仍保留。无公共装配变更、无新导出或注册需求。未提交、推送、打包、发布或部署。剩余验收：构建重启后的售后连续自动刷新；有真实非空商家待办及多页待处理工单时，再验证生产采集器全量聚合和详情映射。
