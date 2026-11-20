# 套餐额度、中文说明与划算比较（2026-11-20）

分支 `codex/billing-plan-value-20261120`，基线 `fd44a95`（1.0.90）。本机实现与隔离验证，未部署生产、未改真实账号额度、未发起真实支付、未启动真实桌面。

## 范围

- `server/overlay/lingtuhost/billing_native.go`：默认标准包 `usage_10000` 调用额度 10000 → 20000，共创支持包 `support_100000` 100000 → 300000。体验包 990 分 / 1000 次、各档价格、365 天/永久条款、渠道与结算规则不变；套餐 ID 保持稳定，服务端自定义套餐配置策略不覆盖。
- 已创建订单继续使用不可变套餐快照；待付款恢复、支付回调、重复入账和同请求号幂等仍按下单金额/调用数校验，旧订单与旧额度不追溯。
- 新增 `server/overlay/lingtuhost/billing_native_test.go` 回归：旧订单目录更新后恢复和入账仍为 10000 次；同请求号换新条款返回 409；新订单取得 20000 次；重复查单不重复入账；旧订单最终保持 10000 次/已入账。
- 新增 `src/modules/billing/plan-value.ts` 纯展示帮助：中文读数、每千次费用、同金额额度比较。不参与价格、订单、额度或传输，非法输入安全退化。
- `BillingDashboard.vue`：套餐卡调用数显示 `20000（两万）次` 等中文括注，收银台快照同样使用服务端原值；每张卡增加每千次费用；非体验包按当前已加载体验包的实际 `amount` 动态显示“同等金额，较体验包多 N% 额度”。百分比精确到一位小数时直接显示（如 137.6%），只有截断/近似值才加“约”；基准缺失/不可比/非正收益不显示。窄屏下 dd 与比较文案允许换行。
- 同 ID 但条款不同的旧待付订单：继续恢复原订单，同时明确提示仍按下单时的价格和额度结算、需先关闭原订单才能购买当前套餐；不自动关单、替换或创建第二笔订单。提示绑定待付订单 ID，关闭/换单或新订单形成后自动隐藏；收银台在创建/恢复等待时显示当前选择，收到实际订单后以订单快照为准。
- 金色支持卡、登录/商户未配置/错误状态、compact 只读、先恢复旧待付款订单、查单/二维码/支付校验和数据隔离未改。

## 关键取舍

- 中文标注只追加括注，真实数字、DTO 字段和传输保持不变；未给价格、订单号、日期加中文。
- 每千次费用按 `amount`（分）× 1000 / `calls` 计算，不能整除到分时标注“约”（体验包 ¥9.90、标准包 ¥5.00、共创约 ¥3.33）。
- 比较基准是已加载的 `usage_1000` 套餐实际 `amount`（9.90），不使用划线原价 10.00；百分比由 `amount/calls` 动态计算，不硬编码 98/197。文案只描述调用额度增幅，不称为费用节省，不承诺回复质量或固定可工作小时。
- 中文读数只支持 0..99,999,999 的整数；`200000` 读“二十万”，仅“二万/二亿”读“两万/两亿”。百分比精确到一位小数；只有截断/近似值才标“约”，避免把约 137.659% 说成 137.7%。

## 实际验证

在 `server/.upstream`（`node server/scripts/prepare.mjs` 刷新，固定提交 `48a6c87`）清空 `LINGTU_TEST_ENGINE`/`LINGTU_TEST_DSN` 后：

| 命令                                                                                                                                                                                    | 结果                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `go test ./lingtu ./lingtuhost -run 'Billing\|Native' -count=1 -timeout=900s`                                                                                                           | 通过；lingtu 0.835s，lingtuhost 29.739s，退出码 0 |
| `go test ./lingtuhost -run 'TestNativeOrdersKeepPlanSnapshotAcrossCatalogUpdate\|TestNativeCatalogDefaultPlansAndChannelIsolation\|TestNativeSupportPlanCheckoutAndCredit' -count=1 -v` | 3 个用例 PASS，含新快照回归                       |

根目录：

| 命令                                                                                                                                                                                               | 结果                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npx vitest run tests/billing-plan-value.test.ts tests/billing-layout.test.ts tests/billing-cashier-dialog.test.ts`                                                                                | 3 文件 / 42 用例通过（含 21 个纯格式/比较用例、旧订单快照、同 ID 旧订单提示、响应快照优先和换单后提示清理） |
| `npx vitest run tests/billing.test.ts tests/billing-payments.test.ts tests/billing-retry-compatibility.test.ts`                                                                                    | 3 文件 / 24 用例通过                                                                                        |
| `npm run typecheck`                                                                                                                                                                                | 通过（vue-tsc + Electron + server tools + tools）                                                           |
| `npx eslint --config config/eslint.config.mjs src/modules/billing/plan-value.ts src/modules/billing/components/BillingDashboard.vue tests/billing-plan-value.test.ts tests/billing-layout.test.ts` | 无输出，退出码 0                                                                                            |
| `npx prettier --check ...`（上述 4 个文件）                                                                                                                                                        | All matched files use Prettier code style                                                                   |
| `node scripts/check-boundaries.mjs`                                                                                                                                                                | 模块依赖方向与组件环境 API 检查通过                                                                         |
| `npm run check:vendor`                                                                                                                                                                             | vendor 80 / server 107 个文件通过                                                                           |
| `npm run build`                                                                                                                                                                                    | vite + build:desktop 通过；仅有既有的大 chunk 与 zod 注释警告                                               |

隔离预览（无头 Chrome + 本地合成 transport，不连托管/数据库/Electron）：

- `artifacts/billing-plan-value-20261120/preview-wide.png`：1440 宽，三档新额度、每千次费用、98%/197% 比较。
- `artifacts/billing-plan-value-20261120/preview-narrow.png`：390 宽，`document.documentElement.scrollWidth === innerWidth`（无横向溢出），卡片与按钮未被顶开。
- `artifacts/billing-plan-value-20261120/preview-cashier-old-order.png`：恢复旧待付订单，收银台显示 `10000（一万）次`、`¥100.00`、365 天；二维码由本机合成文本生成。
- 预览页面顶部固定标注“隔离合成预览：仅本地假数据，不含真实账号、订单或支付”。

## 未完成与边界

- 未部署生产服务、未更新线上套餐、未验证真实新付款；线上目录仍由部署授权单独决定。
- 未运行完整 Go 套件、`npm run check`、`npm run test:desktop`、Release/打包、原生管理网页或 Linux 服务构建。
- Go 仅确认相关 `lingtu`/`lingtuhost` 包测试编译并通过；未运行 MySQL/PostgreSQL 矩阵。
- 预览使用组件级合成数据，不代表真实登录、托管账本或商户配置；截图证据保存在 ignored `artifacts/`。
