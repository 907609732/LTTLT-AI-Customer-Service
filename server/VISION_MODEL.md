# 托管视觉路由与图片验证

本文件说明 2026-11-19 的服务端视觉覆盖层。范围仅限 `server/overlay` 及必要的固定上游补丁；不涉及桌面公共视觉配置、生产部署或真实模型调用。

## 路由契约

- `TrialPolicy.vision_model` 可选。字段缺失或为空时，图片请求保持旧行为：在授权范围内选择首个就绪的 `qwen3-vl-plus` 上游。
- 显式 `vision_model` 必须是当前 `model_scope` 已授权模型，并且对应 `ModelConnection` 同时满足：已启用、渠道启用、`config_hash` 与当前渠道一致、凭证已配置、`image_test_status=success`、`image_tested_hash=config_hash`、图片验证时间非零。
- 显式路由不会自动扩大 `allowed_models`。保存策略时任一条件不满足，整个事务失败，原策略与额度不变；切换回空字段恢复旧 Qwen 路由。
- 含图片请求始终由服务端选路。客户端可选文字模型仍须授权，但不能把图片请求改到文字渠道或绕过视觉验证。路由、渠道快照、凭证和图片校验均在 `ReserveWithLimits` 之前完成；失败不预留额度、不调用上游、不改变账本。
- 成功请求继续记录实际服务端模型别名、实际上游模型、渠道、成本和现有 `managedUsage`。

## 管理员图片验证

- `POST /api/lingtu/admin/config` 的 `section=model_connection` 新增 `action=verify_vision`，请求绑定 `connection_id`、`revision`、`config_hash`。
- 验证使用服务端生成的固定合成 PNG：上半红色、下半蓝色；提示词不包含颜色答案，响应必须精确给出 `red, blue`（忽略大小写、标点和空白），仅“有非空响应”不算成功。
- 探针复用固定上游的渠道 relay 测试入口，只读取探测结果；不创建 `managedUsage`、不预留/扣减试用或付费额度、不改动内部渠道状态或能力。
- 探针完成后以 `revision + config_hash + 当前渠道 hash` 做 CAS 更新。并发保存、改 Key/端点/模型或禁用渠道后的旧结果被拒绝，不覆盖新配置。
- 普通文字连接测试成功不会写入 `image_test_status`。图片验证失败只记录 `failed` 并关闭显式视觉路由，不清空原文字连接。

## 固定上游补丁

`patches.json` 仅给 `controller/channel-test.go` 增加三个锚点：

1. 允许 overlay 通过受限 context key 注入固定的 `dto.Message` 图文消息。
2. 将测试 response body 暴露给同一 controller 包内的图片探针做答案核对。

没有新增通用路由、模型 SDK 或公开测试端点。补丁仍由 `prepare.mjs` 从固定提交重新应用。

## 验证范围

已执行的聚焦命令与结果见 `artifacts/size-vision-20261119/managed-vision-implementation-report.md`。测试只使用隔离 SQLite、固定合成图、mock 回环和 Bun 本地依赖，不部署生产、不写真实账本、不调用付费模型。
