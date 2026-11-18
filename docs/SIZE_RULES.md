# 尺码规则域（结构化规格）

本说明对应 2026-11-19 `Task 1`：把旧 `6235fd0` 尺码草稿的业务语义移植到当前 TypeScript/Electron/Vue 架构。旧 React/CJS 整树未恢复；只复用闭区间、单位、绑定互斥、证据预算和模板等规则。

## 文件与职责

| 文件                                                            | 职责                                                                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/contracts/size-rules.ts`                            | 公共 Zod DTO、单位表与换算、闭区间校验、命令/动作常量。不依赖上层。                                                         |
| `electron/size-rules/store.ts`                                  | `size-rules.json` 启动全量校验、临时文件 + fsync + rename 原子写、全局 revision 与规则 version CAS。                        |
| `electron/size-rules/validate.ts`                               | 规则归属复合键、停用规则占位、唯一绑定校验。                                                                                |
| `electron/size-rules/context.ts`                                | 唯一证据解析器：按 `storeId + productId` 匹配启用规则、商品目录二次核对、单位换算、`eligibleLabels`、缺参数澄清、大表降级。 |
| `electron/size-rules/table.ts`                                  | PapaParse CSV/TSV 预览、公式安全导出、空白/女装/男装/鞋/收纳模板。                                                          |
| `electron/size-rules/service.ts`                                | `execute(action, payload)` 与 `resolve(storeId, productId, question, thread)`。                                             |
| `electron/size-rules/inject.ts`                                 | 在压缩器前把完整证据放入 `messages` 和 `knowledge`，并用 `protectedMessages` 计入同一 token 预算；禁止压缩后追加。          |
| `electron/size-rules/guard.ts`                                  | 选码请求直接生成表内确定性结果；未知码不能靠正则绕过。                                                                      |
| `electron/size-rules/request-state.ts`                          | 用 `AsyncLocalStorage` 把一次请求的提示证据与最终回复守卫绑定；训练在外层复用同一状态。                                     |
| `electron/size-rules/candidate-guard.ts`                        | 按生成 trace 绑定候选到规则版本/商品/会话；规则变化时与 knowledge/PDD 当前性检查组合失效。                                  |
| `electron/size-rules/training-output.ts`                        | 对训练最终禁用词/店铺截字后的回复只校验、不重写；违规明确失败。                                                             |
| `electron/size-rules/runtime-assembly.ts`                       | 承载尺码文件损坏/不可用错误，只禁用尺码域，不阻断普通客服启动。                                                             |
| `src/modules/knowledge/size-rules-service.ts`                   | 渲染层窄服务，只经现有 `runtime.run()` 业务命令。                                                                           |
| `src/modules/knowledge/components/use-size-rules-controller.ts` | 草稿与所有异步请求的 workspace/存活/请求/草稿 owner；迟到成功、失败和导出均不应用。                                         |
| `src/modules/knowledge/components/SizeRuleTableEditor.vue`      | 列、行、单位和测量参数编辑子组件。                                                                                          |
| `src/modules/knowledge/components/SizeRuleBindingEditor.vue`    | 真实商品目录多店绑定、分页和归属提示子组件。                                                                                |
| `src/modules/knowledge/components/SizeRulesPanel.vue`           | 规则列表、模板、CSV 预览/导出、删除确认和上述子组件装配；保留 `ShopKbPanel` 原自由文本入口。                                |

## 命令与结果

业务动作加入 `src/shared/contracts/backend.ts`：

`list-size-rules`、`save-size-rule`、`remove-size-rule`、`preview-size-table`、`export-size-table`、`size-rule-template`。

`local-runtime.execute` 在现有 workspace/命令校验之后转发给 `createSizeRulesService`，没有新增 IPC 通道，也没有新增发送入口。

- `list-size-rules`：`{ revision, total, boundProducts, units[], rules[] }`
- `save-size-rule`：草稿 + `expectedRevision`；更新时再带 `id`、`version`。返回 `{ rule, revision }`。
- `remove-size-rule`：`{ id, version, expectedRevision, confirmed: true }`。
- `preview-size-table`：`{ table }`，最大 1 MB；只返回预览，不保存。
- `export-size-table`：`{ id }`，返回已保存规则 CSV。
- `size-rule-template`：`{ kind: 'blank'|'women'|'men'|'shoes'|'storage' }`，仅返回未启用、未绑定草稿。

规则容量：名称 1..100、列 1..12、行 1..100、绑定 0..500、选码参数 0..6、说明 ≤3000。单单元格 ≤200，单文件最多 100 条规则。启用状态要求所有单元格非空，且每个选码参数能对应同名数字参数列。

## 关键约束

- **绑定唯一**：任意两条规则（含停用规则）不能共用同一 `(storeId, productId)`；不同店铺相同商品编号互不影响。删除后才释放。
- **真实目录核对**：`local-runtime` 使用现有 `productCatalog.list()` 精确检查当前商品目录；自动测试只注入临时合成目录端口，不访问真实平台。结果分为 `valid`、`missing`、`error`。保存时对所有不同绑定重新核对；目录抛错时拒绝保存且原文件不动，不把错误当成未配置规则。读取证据时 `missing/error` 不输出表事实；选码返回可重试澄清，普通聊天继续。
- **数据约束的 eligibleLabels**：只有请求选码、必需测量参数齐全，且存在同名数字参数列时才计算。测量值先换算到列单位，再用闭区间（含端点）筛选；只使用固定 `1e-9` 浮点表示容差，不做向区间内舍入，也不随数值放大。
- **缺参数澄清**：仅真实选码推荐追问缺少的身高/体重/脚长等；普通问候和直接“M身高范围/ L体重上限”等查表请求不追问。出现“给妈妈/孩子/换个人”等换被测人语义时，按最后换人标记的字符位置截断，之后的新测量仍属于新对象。
- **大表与预算**：证据 JSON 超过 9000 字节时返回 `rows: []`、`complete:false`、`rowLabels` 和明确“指定尺码/规格”澄清；不截断残缺 JSON。完整证据在压缩器前进入 `messages` 和 `knowledge`，并通过 `protectedMessages` 计入 16K 触发与 8K 目标；压缩重建仍缺证据时停止发送，不在压缩后无预算追加。
- **同源接待/训练/试问**：`createSizeContextPreparation` 由接待和训练共用的 `prepareModelContext` 调用；正式知识库 `trial` 也在 `knowledge-runtime` 的同一 `complete` 预算/租约链中注入证据并复核版本。`installSizeReplyGuard` 包装同一个 `backend.engine.aiClient.reply`。训练最终禁用词/店铺 `modelProfiles` 截字后由 `applySizeTrainingOutput` 只校验、不重写：出现范围外/未知尺码或迟到规则变化时明确失败，不重新插入禁词、不扩大店铺字数。接待 `beforeSend` 拿到过滤后的最终文本也执行同一只读校验，失败即拒绝发送并保留 knowledge/PDD 门。
- **最终拒绝**：`selectionRequested=true` 时不再采用模型自由文本推荐，而由表内 `eligibleLabels`/`clarification` 生成确定性选码回复，因此“XL 最合适”“加大码更合适”等未知码无法绕过；直接查表请求和普通问候保留原流程。模型返回后再次读取当前证据，规则停用、改绑或 `ruleVersion` 变化时返回安全失败。
- **候选失效**：候选按生成 trace 绑定规则版本、商品、测量和会话；规则停用/解绑/编辑于生成或待审核期间，`invalidReason/isCurrent` 与现有 knowledge 引用守卫、PDD 一次性发送授权组合，不覆盖也不绕过原确认门。两个买家并行候选各自使用自己的 trace，不读取全局 latest trace。证据表最多 1000 个 reply trace，每个显式保存 `evidence|null`；明确无尺码的 null 保持普通回复，unknown/淘汰的 AI trace 闭锁。训练/试问 trace 不占用正式回复候选位置。
- **自由文本兼容**：`ShopKbPanel` 原自由文本预览、审核入库与 `source.kind='size'` 知识包保持不变；结构化规则不自动迁移旧知识，不覆盖知识包，不自动启用或绑定。

## 存储与并发

数据文件位于当前本机业务目录的 `size-rules.json`。启动时严格解析并核对规则 ID、完整字段和绑定唯一性；损坏文件保持原样。`runtime-assembly` 捕获该领域错误，尺码命令和真实选码请求明确失败，普通客服文字继续启动；不会静默当作空规则推荐。保存使用同目录临时文件、`fsync`、`rename`，失败时原文件不动并清理临时文件。

所有写命令都携带 `expectedRevision`；更新/删除还检查规则 `version`。异步目录校验完成后、同步 commit 之前再次核对全局 revision 和规则 version，两个旧 revision 同时保存只能成功一个。删除不依赖绑定目录校验，因此失效绑定仍可被用户删除。界面 controller 统一按 workspace、组件存活、请求序号和草稿代次丢弃迟到成功/失败/导出；切换店铺后的迟到商品结果不会覆盖新店列表。

CSV 导出第一行为 `#lingtu-size-table-v1`。只有该版本格式会反转公式安全导出的单引号转义；普通外部粘贴保留字面 `'=1`，自身导出再导入可还原原文本、公式类表头和单元格。

## 验证

专项测试：

```powershell
npx vitest run --no-file-parallelism --maxWorkers=2 --minWorkers=1 `
  tests/size-rules-store.test.ts tests/size-rules-context.test.ts `
  tests/size-rules-table.test.ts tests/size-rules-reply.test.ts `
  tests/size-rules-runtime.test.ts tests/size-rules-candidate.test.ts `
  tests/size-rules-compression.test.ts tests/size-rules-runtime-startup.test.ts `
  tests/size-rules-ui.test.ts tests/knowledge-learning-ui.test.ts
```

覆盖：原子写/双 CAS/重启/损坏文件保留、含停用规则的绑定互斥、跨店同号、目录 valid/missing/error、单位换算和固定容差、缺参数澄清、同条换人字符截断、大表、CSV 版本标记/字面单引号/公式往返、模板未启用、未知 `XL` 确定性拒绝、真实训练模型通路及目录失败、16K→8K 真实压缩、候选版本失效与 PDD 授权组合、workspace/草稿/卸载迟到结果、失败保留草稿。

类型/静态/构建：

```powershell
npx vue-tsc --noEmit
npx tsc -p config/tsconfig.electron.json --noEmit
npx eslint --config config/eslint.config.mjs <changed files>
npx prettier --check <changed files> --config config/prettier.json
node scripts/check-boundaries.mjs
npm run build
```

## 未交付与边界

- 未实现视觉模型独立配置或托管视觉渠道。
- 未访问真实平台商品目录、真实店铺、真实模型或发送买家消息；商品绑定验收使用合成目录和既有本地商品命令。
- 未发布 Release、未改 server/vendor、未 bump 版本。
- 模型仍可能输出自然语言差异；选码请求由确定性表内结果约束，不把提示词或有限推荐动词正则当作安全边界。
- 未在完整 Electron 主进程生命周期中启动本工作树；损坏文件 containment 由 `local-runtime` 实际使用的 `runtime-assembly` 与真实 compressor/训练装配测试覆盖，最终仍需整合时的原生启动复核。
