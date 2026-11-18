# 尺码规则域（结构化规格）

本说明对应 2026-11-19 `Task 1`：把旧 `6235fd0` 尺码草稿的业务语义移植到当前 TypeScript/Electron/Vue 架构。旧 React/CJS 整树未恢复；只复用闭区间、单位、绑定互斥、证据预算和模板等规则。

## 文件与职责

| 文件                                                  | 职责                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/shared/contracts/size-rules.ts`                  | 公共 Zod DTO、单位表与换算、闭区间校验、命令/动作常量。不依赖上层。                                                         |
| `electron/size-rules/store.ts`                        | `size-rules.json` 启动全量校验、临时文件 + fsync + rename 原子写、全局 revision 与规则 version CAS。                        |
| `electron/size-rules/validate.ts`                     | 规则归属复合键、停用规则占位、唯一绑定校验。                                                                                |
| `electron/size-rules/context.ts`                      | 唯一证据解析器：按 `storeId + productId` 匹配启用规则、商品目录二次核对、单位换算、`eligibleLabels`、缺参数澄清、大表降级。 |
| `electron/size-rules/table.ts`                        | PapaParse CSV/TSV 预览、公式安全导出、空白/女装/男装/鞋/收纳模板。                                                          |
| `electron/size-rules/service.ts`                      | `execute(action, payload)` 与 `resolve(storeId, productId, question, thread)`。                                             |
| `electron/size-rules/inject.ts`                       | 在 token 压缩前后注入完整证据 JSON，避免 JSON 被截断。                                                                      |
| `electron/size-rules/guard.ts`                        | 模型回复后的最终白名单约束：范围外推荐改为安全澄清。                                                                        |
| `electron/size-rules/request-state.ts`                | 用 `AsyncLocalStorage` 把一次请求的提示证据与最终回复守卫绑定，避免并发改规则后错用新旧标签。                               |
| `src/modules/knowledge/size-rules-service.ts`         | 渲染层窄服务，只经现有 `runtime.run()` 业务命令。                                                                           |
| `src/modules/knowledge/components/SizeRulesPanel.vue` | 规则列表、表格编辑、真实商品绑定、模板、CSV 预览/导出、删除确认；保留 `ShopKbPanel` 原自由文本入口。                        |

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
- **真实目录核对**：`local-runtime` 的超集使用现有 `productCatalog.list()` 精确检查当前商品目录；自动测试只注入临时合成目录端口，不访问真实平台。保存时对所有不同绑定重新核对，读取证据时再核对当前绑定。失效、移除或店铺不存在的商品不会进入上下文。
- **数据约束的 eligibleLabels**：只有请求选码、必需测量参数齐全，且存在同名数字参数列时才计算。测量值先换算到列单位，再用闭区间（含端点，`1e-9` 容差）筛选。没有测量列或没有匹配值时 `eligibleLabels=[]`，不得推荐。
- **缺参数澄清**：仅选码请求追问缺少的身高/体重/脚长等；普通问候和指定规格尺寸查询不追问。出现“给妈妈/孩子/换个人”等换被测人语义时，截断更早的测量数据。
- **大表**：证据 JSON 超过 9000 字节时返回 `rows: []`、`complete:false`、`rowLabels` 和明确“指定尺码/规格”澄清；不截断残缺 JSON。若问题已指定单行，可返回该行完整记录。
- **同源接待/训练**：`createSizeContextPreparation` 由接待和训练共用的 `prepareModelContext` 调用；`installSizeReplyGuard` 包装同一个 `backend.engine.aiClient.reply`。训练不发送买家消息，也不改变 AI 开关或审批门。
- **最终拒绝**：模型输出的 `sizeLabel` 只能来自 `eligibleLabels`；输出文本中出现的表内尺码也不能超出白名单。范围外标签、缺少测量仍推荐、或未知推荐码（如 `XL`）都会替换为证据内安全澄清，并清空图片/视频/卡片/券字段。普通问候和指定规格查询不启用该推荐限制。守卫在模型返回后再次读取当前证据；规则被停用、改绑或 `ruleVersion` 变化时返回安全失败，不采用迟到旧结论。
- **自由文本兼容**：`ShopKbPanel` 原自由文本预览、审核入库与 `source.kind='size'` 知识包保持不变；结构化规则不自动迁移旧知识，不覆盖知识包，不自动启用或绑定。

## 存储与并发

数据文件位于当前本机业务目录的 `size-rules.json`。启动时严格解析并核对规则 ID、完整字段和绑定唯一性；损坏文件保持原样并报错。保存使用同目录临时文件、`fsync`、`rename`，失败时原文件不动并清理临时文件。

所有写命令都携带 `expectedRevision`；更新/删除还检查规则 `version`。全局修订或规则版本过期时拒绝写入。异步结果在界面侧按 workspace 和目录请求序号丢弃；切换店铺后的迟到商品结果不会覆盖新店列表。

## 验证

专项测试：

```powershell
npx vitest run tests/size-rules-store.test.ts tests/size-rules-context.test.ts tests/size-rules-table.test.ts tests/size-rules-reply.test.ts tests/size-rules-runtime.test.ts tests/size-rules-ui.test.ts tests/knowledge-learning-ui.test.ts
```

覆盖：原子写/CAS/重启/损坏文件保留、含停用规则的绑定互斥、跨店同号、真实目录端口拒绝失效商品、单位换算和闭区间、缺参数澄清、换人截断、大表、CSV/TSV/公式/往返、模板未启用、模型范围外拒绝、真实训练模型通路、换店迟到商品结果、失败保留草稿。

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
- 模型仍可能输出自然语言差异；最终档位由确定性白名单守卫约束，不把提示词当作安全边界。
