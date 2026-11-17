# 模型 token 人民币成本估算

管理后台 → 模型配置 → 选择一条 API：填写输入、输出和可选缓存命中单价，单位为人民币元／百万 token。单价支持 0 至 1000000，最多六位小数，不支持指数、负数和前导零。留空未配置，显式 0 为免费。使用服务商或协议人民币单价；系统不硬编码报价或汇率。修改单价可在更多设置中“仅保存，不检测”，不会让已检测连接失效。

新调用在进入模型前固定同一连接版本的实际模型及价格；结算时根据服务商报告用量计算费用。调用途中及之后改价不影响已保存的快照。金额为整数微元（1 元 = 1000000 微元），中间计算使用大整数，每次调用最后四舍五入一次，汇总仅累加已经保存的金额。界面显示六位小数，小于半微元的单次费用按此规则舍入为零。

费用公式：`(输入总量 - 缓存命中) × 输入价 + 缓存命中 × 缓存价 + 输出量 × 输出价`，按每百万 token 换算。支持 OpenAI `prompt_tokens_details.cached_tokens` 和 DeepSeek `prompt_cache_hit_tokens`，缓存命中必须在输入总量内，多来源冲突为未知。未配置缓存价时全部输入按输入价估算；配置缓存价但没有缓存明细时费用标为无法估算。

## 后台显示与接口

- `/api/lingtu/admin/config`：连接返回 input_cny、output_cny、cache_read_cny，单位相同；POST config 的 model_connection/save 在 cost_rates 对象中接收同名价格。显式 null 或空字符串清空，省略字段保留；零价有效。管理员验证、审计和 revision 规则沿用 main 实现。
- `/api/lingtu/admin/usage`：每次调用返回历史价格、`cache_read_tokens`、`cache_usage_known`、`cost_micros`、`cost_known`、`cost_status`。只有 `cost_known=true` 才代表已知估算，不能单独把数字 0 当作免费。
- `/api/lingtu/admin/usage-summary`：账号及全部历史汇总增加 `cost_micros`（已知小计）、`unknown_cost_requests`（未知费用次数），不受分页影响。
- `/api/lingtu/admin/usage-daily`：今日、7/30 日、实际模型分组均返回相同金额和未知次数，继续按北京时间自然日及请求账本过滤。

`cost_status`：estimated、pending、unknown_usage、missing_price、cache_usage_unknown、missing_snapshot、cost_overflow。旧记录缺价格快照时保持未知，不用当前报价追算历史。失败、拒绝向客户端交付但已产生用量的调用都保留成本；重放不会重复计费。连接测试不在客户端成本账本中。

摘要压缩调用同样保存成本：它复用主聊天的限定价格快照，写入实际 token 用量与 `cost_micros`/`cost_status`，但按生产规则不扣试用/付费次数，重放仍只保留一条成本记录。主聊天继续使用生产原生额度扣费。服务探针版本为 `2026.11.17-cost.1`，能力名包含 `token-cny-cost-estimates`。

此处是运营模型成本估算，与客户套餐扣次、充值和服务商最终账单独立。图像/音频/工具附加费、阶梯报价、缓存写入费等未能从当前输入/输出/缓存读取单价推导的项目不包含在估算中。

## 兼容与验证

保留 main 的 cost_rates、estimated_cny、cost_basis 兼容接口，均从同一微元金额派生。历史 CostSnapshot=true 的记录只使用自身历史单价兼容读取；没有历史快照时保持未知。不会用现价重估旧调用。

验证命令 npm run server:verify:databases，报告见 artifacts/verification.json 和 artifacts/database-matrix/verification.json。CI 工作流运行完整 service 三引擎、托管双引擎及原生管理网页检查/构建，并输出带提交号和 SHA256 的 Windows 本机预览产物。仅使用隔离数据库和模拟模型，未调用付费服务商。
