# 接待功能补齐实施计划

规格：../specs/2026-11-12-feature-parity.md
执行方式：当前隔离worktree逐项实施；分支codex/reception-feature-parity-20261112，基于PR16的5e7d11e。PR16保持原样，新增功能单独交付。

## 文件与步骤
1. tests/desk reply-engine回归先红后绿，修正自动回复时间被误当人工回复导致漏掉在途新问题；保留人工接管和限速规则。跑完整基础检查建立新基线。
2. electron/product-knowledge.cjs实现严格schema/原子存储/导入/中文检索，复用MiniSearch(MIT)和PapaParse(MIT)；tests/product-knowledge.test.mjs验证隔离、导入原子性、损坏文件和中文查询。backend命令与快照接入；StoreManagement添加现有商品区域入口，ProductKnowledge.tsx实现可用编辑/导入/查询；接待与训练检索同源。
3. electron/intent-knowledge.cjs知识包/条目/绑定，复用同一检索和存储基础；IntentKnowledge.tsx接入UX15并保留设计节点。针对问法、商品限制、禁用、跨店隔离与导入测试。
4. ConversationQuality和AuxiliaryCenter纠错面板只执行显式知识写入命令；保存版本校验、来源审计和账号失效处理。
5. electron/model-profiles.cjs及UX17方案界面；真实worker getConfig按店铺应用绑定规则。全局旧规则向后兼容。
6-13. 按规格逐项补独立任务brief与红绿测试。现成routing/welcome配置只适配必要提交，不能整分支覆盖PR16新发送与账号逻辑。平台动作通过能力协商与确认回显逐步开放。

## 每项交付门槛
类型检查、针对性单元测试、完整根/引擎测试与build；UI改动跑浏览器交互，主进程改动跑隔离Electron集成。记录可运行与尚待真实平台验收的边界。云端检查和源码运行同批提交，未合并/未发布前不声明正式上线。

## 复用依据
- 现有Config、StoreRegistry、AiClient、ReplyEngine、atomic JSON、backend snapshot/commands。
- MiniSearch https://github.com/lucaong/minisearch （MIT，Node/浏览器，支持自定义中文tokenizer）；PapaParse https://github.com/mholt/PapaParse （MIT，CSV解析不自行重写）。
- 跨平台SDK与媒体/转接能力将在各自任务开始前核对官方文档、许可证和实际登录环境。

## Task 3 brief：意图知识包
- 输入：包名、启用状态、店铺ID绑定、可选商品编号绑定；条目含问法、关键词、标准答案、启用状态。
- 输出：严格版本化本地记录、CRUD/JSON预览导入、仅匹配当前店铺/商品的检索；与商品参考一同送入实际回复及训练。
- 不自动向买家发送固定话术，不自动开启AI；模型仍须遵守全局规则。
- RED：跨店隔离、同编号不同店铺、商品限制、禁用/过期版本、坏文件不覆盖；managed transport的实际messages必须出现匹配条目。
- GREEN：服务→backend→UX15；根/引擎/build/浏览器/Electron验证后提交。

## Task 4 brief：人工纠错学习
- 质检详情和辅助中心显式打开纠错面板；选取真实买家消息，编辑标准答案，二次确认后仅保存本店知识。
- 命令携带店铺、顾客、质检记录及版本，校验消息内容/时间仍存在；记录来源审计，重复确认不重复新增。
- 不改平台历史、不自动发送、不解除AI会话限制；账号切换使旧表单失效。
- 测试覆盖错误顾客/版本、重复提交、来源持久化、检索命中及UI明确确认。

## Task 5 brief：店铺模型规则方案
- 复用现有全局规则为默认方案，增加可命名的提示词方案和店铺绑定；不新增密钥副本，也不覆盖托管账号服务端模型授权。
- 实际worker与训练场按当前店铺解析规则；未绑定沿用全局。删除方案须确认并显式解除绑定回全局。
- 严格版本与损坏文件保护；切换账号隔离；不改变AI开关。保持旧save-config UX17兼容。
- RED覆盖多店不同规则、实时绑定/解绑、删除确认、版本/损坏保护，worker/training使用一致。

## Task 6 brief：新会话欢迎
- 复用旧分店欢迎草稿文件（v1 text），迁移为v2启用/文字/版本及持久化新顾客账本；默认关闭。欢迎与AI正文合并为一次受控发送，使用同一节奏/取消/手动接管校验。
- 首次采集的顾客须在欢迎开启后、消息新鲜且平台历史无更早对话。已有本机顾客预先登记为旧会话；历史回放、重启和未知发送均不重复欢迎。
- 平台没有无消息访客进入事件，第一版准确标为“新会话首条回复欢迎”，不伪装无消息访客欢迎。
- RED：分店/重启/旧会话、历史、原子损坏保护，worker正文合并一次、人工接管取消不消耗欢迎。

## Task 7 brief：真实多模态接待
- 复用既有OpenAI兼容HTTP与New API托管链路，采用官方Qwen3-VL图片content parts（https://help.aliyun.com/en/model-studio/qwen-vl-compatible-with-openai）。不引入新的模型SDK、OCR进程或另存Key。
- 托管端新增独立qwen-vision渠道（qwen3-vl-plus），管理员显式配置/测试并绑定账号或默认模型；/me声明能力。客户端仅在实际模式支持时允许开启本店识图。
- URL图像最多4张，公网HTTPS域名、无凭据/非标准端口/片段，禁止IP/内网名字及data/file等协议；仅user消息可携带图片。文字仍受32KiB/128KiB总体限额；上游负责读取图片，不经3Mbps站点转存。
- 实际接待保留image类型，不把URL拼成文字让模型猜；开启后向受支持模型送真实image_url；停用/不支持/不安全链接/识别失败转本会话人工提示，不自动编造视觉结果或循环重试，不关全店。
- UX14每店开关和训练识图验证，训练不发给买家；账号隔离、未知结果不重试、请求idempotency不变。
- RED：跨JS/Go协议、无能力不调用、图片payload真正抵达transport、URL与数量限制、server渠道/能力/账本、worker正常识图及失败只暂停该会话、三尺寸UI与Electron。

## 审计补齐 brief（任务2/4/5）
- 商品：扩展编码、结构化SKU（编号/规格/价格说明/参考库存）、持久化来源；兼容旧数据，CSV内SKU使用JSON列；JSON整批预览、确认、重复策略和原子校验，跨店导入只写指定店铺。
- 会话采集：现有consultGoods实为推荐列表首项，不能当当前商品。改用当前顾客最近明确带商品编号的会话消息；只读预览后凭短期令牌与产品revision确认写入。无明确商品信息准确报缺失，不做全量同步。
- 纠错：允许选本店已绑定且无商品限制的目标知识包，校验包版本、启用状态及会话版本；追加单条问答并保留来源审计，重复确认不重复写入，不发送消息。
- 方案：复制当前内容为独立新草稿，保存才生成新方案，不继承绑定关系。
