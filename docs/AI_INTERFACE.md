# AI调用接口（源码 1.0.70）

灵兔AI提供标准MCP stdio连接器和命令行连接器。外部AI通过工具调用当前运行的软件服务，不需要桌面点击、DevTools端口或直接操作SQLite。两者复用同一认证gateway、配置校验、版本CAS和请求去重，不各自维护一套配置写入。

## 接入

1. 安装系统Node.js 20以上（本机已验证Node24），启动灵兔AI最新版，并完成原有账号登录。命令行和MCP都连接**正在运行的同一实例**；软件未启动时只返回连接失败，不会直接改数据文件。
2. 打开 `%APPDATA%/yunduo-ui-restored/ai-interface/mcp-config.json`，将其中的 `lingtu-ai` 服务配置加入支持本地stdio MCP的客户端。软件每次启动生成当前源码/安装版对应的绝对路径，配置中不含密钥。宿主界面和配置格式不同，按其MCP服务器入口接入，不会自动修改其他AI客户端配置。
3. 连接后先调用 `lingtu_status`，取得当前 `workspaceId`；再调用 `lingtu_list_stores` 找到店铺ID。工作区改变后重新查询，不沿用旧ID。

源码配置示例（实际以自动生成的文件为准）：

```json
{
  "mcpServers": {
    "lingtu-ai": {
      "command": "node",
      "args": [
        "C:/Users/90760/.codex/worktrees/knowledge-library-refactor/client/dist-electron/lingtu-mcp.cjs"
      ]
    }
  }
}
```

自定义资料目录的生成配置额外带 `--connection-file` 指向该实例自己的连接文件；普通使用不必填写端口或口令。`connection.json` 是短期本机凭据，不要放入模型提示词、公开配置或日志。安装版连接器随应用放在 `resources/ai-interface/lingtu-mcp.cjs`，不依赖Node读取asar。

### 命令行

源码先执行一次 `npm run build:desktop`，然后使用 `dist-electron/lingtu-cli.cjs`，或直接运行便捷脚本 `npm run ai -- ...`。安装版为 `resources/ai-interface/lingtu-cli.cjs`。命令只接受实例连接文件，不把端口或口令作为参数。

```powershell
node dist-electron/lingtu-cli.cjs status
node dist-electron/lingtu-cli.cjs stores --json '{"workspaceId":"..."}'
node dist-electron/lingtu-cli.cjs config schema
node dist-electron/lingtu-cli.cjs config get --json '{"workspaceId":"...","group":"reply-pacing"}'
node dist-electron/lingtu-cli.cjs config preview --json '{"workspaceId":"...","group":"welcome","storeId":"...","patch":{"text":"欢迎光临"}}'
node dist-electron/lingtu-cli.cjs config apply --json '{"workspaceId":"...","group":"welcome","storeId":"...","requestId":"once-1","expectedVersion":"<get或preview返回值>","patch":{"text":"欢迎光临"}}'
```

`--json` 也可省略并通过stdin传入JSON。`--connection-file <完整路径>` 指定其他实例；`--help` 查看用法。成功时stdout输出 `{"ok":true,"data":...}`，失败输出 `{"ok":false,"error":"..."}` 并以非0退出。写调用只发送一次，不自动重试；超时或结果未知时先重新执行 `config get` 核对，不要换requestId重放。

## 工具

| 工具                      | 功能                                 | 写入范围                     |
| ------------------------- | ------------------------------------ | ---------------------------- |
| `lingtu_status`           | 版本、工作区、服务可用性和登录状态   | 无                           |
| `lingtu_list_stores`      | 当前账号店铺与连接状态               | 无                           |
| `lingtu_open_store`       | 打开已登记店铺窗口，登录由用户完成   | 复用原窗口服务，不启用AI     |
| `lingtu_summary`          | 本店知识库统计                       | 无                           |
| `lingtu_list_products`    | 分页查询已有商品知识                 | 无                           |
| `lingtu_list_knowledge`   | 分页查询知识与草稿                   | 无                           |
| `lingtu_list_jobs`        | 查询任务状态、进度与错误摘要         | 无，不返回内部任务载荷       |
| `lingtu_read_catalog`     | 核对当前平台店铺，读取在售目录       | 不自动采集/学习/发布         |
| `lingtu_start_collection` | 按已核对的目录范围采集明确选择的商品 | 只采集原料，返回jobId        |
| `lingtu_save_draft`       | 创建/编辑本店私有知识草稿            | 标为模型生成，保持待人工审核 |
| `lingtu_config_schema`    | 配置分组、作用域、字段类型和范围     | 无                           |
| `lingtu_get_config`       | 读取一个配置分组、当前值和version    | 无                           |
| `lingtu_preview_config`   | 预览严格部分补丁及字段差异           | 不写盘                       |
| `lingtu_apply_config`     | 按expectedVersion和一个分组提交修改  | 复用原生保存与版本CAS        |

除status和config_schema外必须携带当前workspaceId；本店工具还须storeId。分页默认20项、最多100项，单次响应最多2MB，过大时明确报错并要求缩小范围，不静默截断。目录分页cursor及identityVersion/scopeToken完全复用现有采集器；接口不增加尚未支持的平台。

## 可修改配置

只开放以下三个分组。字段发现以 `lingtu_config_schema` 为准；每次只提交一个分组，不提供隐式跨店批量写入。

| 分组           | 作用域 | 字段                                                    | 默认/约束                                                               |
| -------------- | ------ | ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `reply-pacing` | 全局   | `mode`、`customMinSeconds`、`customMaxSeconds`          | 模式四选一；自定义为1～3600整数秒且下限不大于上限；默认1～3秒随机       |
| `welcome`      | 店铺   | `text`、`enabled`、`delayMinSeconds`、`delayMaxSeconds` | 文字最多200字；延迟1～3600整数秒；缺失记录按空文字、关闭、1～3秒读取    |
| `vision`       | 店铺   | `enabled`                                               | 只开放识图开关；当前模型不支持图片时preview/apply均明确拒绝，不假装成功 |

`get`/`preview` 返回的 `version` 是配置内容的CAS版本；`apply` 必须原样带回 `expectedVersion`，并携带新的唯一 `requestId`。预览只返回当前值、修改后值 `effective` 和字段 `changes`，不执行保存。保存走与桌面相同的 `save-config`（REPLY_PACING）、`save-welcome`、`save-vision-settings` 命令，并使用原生版本字段；若界面在这期间先保存，原生CAS会拒绝旧请求，不会丢界面修改。保存成功后从新快照回读实际值，不把命令受理冒充成功。重复提交同一requestId且参数相同返回原结果；同ID改参数被拒绝；工作区变化时去重缓存清空。未知字段、空补丁、旧workspaceId或storeId、旧expectedVersion和越界值都在写入前失败。

## 边界

配置工具不修改模型密钥、模型参数/提示词、登录状态、AI启停、发送模式或逐条发送审批，不开放任意命令、文件、SQL或数据库访问，也不返回凭据。识图开关不保证模型支持图片输入，保存前仍由原生能力检查拒绝。其他清除、恢复备份、审核发布、给买家发送消息、支付、脚本执行继续只走软件现有入口与确认流程。

采集流程：读取目录 → 选择productIds → 使用该返回的identityVersion、scopeToken和total调用start_collection → list_jobs查询进度。只支持明确选择，不能用任意商品链接/URL绕过平台账号校验；不自动学习模型，也不消耗模型学习额度。

写入必须提供requestId，同一进程/工作区内重复提交同样参数返回原结果；同ID不同参数拒绝。缓存最多500项，工作区变更时清空，达到上限需重启。它不是跨进程持久任务账本；连接中断或超时可能已完成写入，AI应先查任务/知识，不得自动换新requestId重试。编辑草稿须提供id和expectedRevision；不允许修改其他店、共享商品或公共模板条目。

除上述三个配置分组外，清除、恢复备份、审核发布、给买家发送消息、开启AI、设置凭据、支付、任意文件/SQL/脚本执行均不在此接口。仍使用软件已有入口与确认流程。

## 实现与校验

`MCP stdio（官方SDK连接器）或 lingtu-cli → 仅127.0.0.1的受限HTTP入口 → agent/service（配置校验、版本CAS、requestId去重）→ 当前WorkspaceRuntime、现有保存命令与知识服务`。配置读写只在主进程完成，CLI不直接打开数据文件；MCP与CLI共享同一套契约和错误语义。

官方依赖为 [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)，固定server/client 2.4.0，Apache-2.0；client只用于验证，server与core许可随连接器分发。采用[官方stdio工具注册方式](https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.4.0/docs/get-started/first-client.md)，不自行实现MCP协议。SDK与本项目TypeScript、Zod4和Node运行环境兼容。

主进程随机分配端口和每次运行令牌，固定Host，拒绝浏览器Origin、无效认证、非白名单工具和超过1MB的请求。连接器从本机私有文件读凭据，通过直接loopback HTTP连接发送，不走宿主代理，不跟随重定向。工具结果不含登录/模型密钥。所有请求绑定当前工作区和认证状态，账号切换、注销或清除后重建会拒绝旧请求及晚到结果。接口启动失败会报告到主进程日志，桌面业务仍可使用；关闭软件时移除本次连接文件。

自动验证使用临时账号/SQLite、真实厂商后端本地夹具、标准MCP Client和CLI子进程；覆盖三组配置的读取、预览不落盘、保存回读、缺失记录默认值、未知/空字段、旧工作区/店铺/版本、并发界面保存、重复requestId、识图能力拒绝和敏感信息不回显。真实账号验收只做状态、店铺和目录读取，不创建测试草稿、不采集真实商品详情、不发送消息、不修改真实配置。安装器分发和其他AI宿主的实际配置界面需各自验收，不能把本地协议通过称为已自动配置所有客户端。
