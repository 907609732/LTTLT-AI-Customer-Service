# 训练场第二轮克隆错误修复验收

日期：2026-11-19。范围：知识库内 AI 训练场，原账号与知识数据不迁移。

## 实现与审查

- 执行者：本机官方 DeepSeek Harness headless，独立 worktree `C:/Users/90760/.codex/worktrees/knowledge-product-editor/client`，分支 `codex/training-clone-fix-20261119`。
- 基线 c0a339d，实现提交 50b0172；退出码 0，最终事件 completed。
- Codex 独立复现：空历史可 structuredClone；写入 Vue ref 后行对象 isProxy=true，原 slice 结果抛 DataCloneError。
- 修复仅在 ShopTrainingPanel 提交处复制最近 20 条消息为普通对象，不清空历史、不使用全局 JSON 序列化、不捕获后伪造成功。
- 业务 diff 为一个发送字段；新回归在执行边界克隆完整命令，确认第二轮、第三轮历史及 11 轮历史上限，另覆盖错误输入保留与只在手动提交时重试。既有店铺/商品隔离、迟到抑制和图片用例继续通过。

## 已执行验证

| 检查                                 | 结果                                         |
| ------------------------------------ | -------------------------------------------- |
| 新回归对旧代码                       | 第二轮报克隆错误；13 项中 1 失败，符合原缺陷 |
| 修复后相关知识库训练测试             | 13/13 通过                                   |
| Vue 类型检查                         | 通过                                         |
| 变动文件 ESLint / Prettier           | 通过                                         |
| 候选源码构建                         | 通过                                         |
| 真实 Electron 主窗口 / preload / IPC | 连续三轮通过，3 次本机回环模型请求           |
| 第二轮输入历史                       | 首轮 buyer/seller 原文均保留                 |
| 第三轮输入历史                       | 前两轮 buyer/seller 原文均保留               |

真实桌面验收采用全新临时 profile 和模拟店铺，不读取正式凭据，不向买家发送。未调用付费模型。首次验收的旧标题栏 CSS 选择器导致等待失败；使用现有 .window-controls 判断渲染就绪后通过。日志中的更新检查缺 handler 来自独立测试装配，与训练链路无关，未掩盖或改动正式更新逻辑。

## 原数据源码启动

用户确认店铺设置已保存并允许重启后，才退出旧源码实例。版本 1.0.86 同步 package 与 lock。原 profile 为 `C:/Users/90760/AppData/Roaming/yunduo-ui-restored`，业务目录为其 `local-runtime`；不改认证、模型、店铺 AI 开关、图片识别设置、审核发送模式和既有知识条目。

最终主线 1.0.86 完整源码构建通过；经既有源码启动脚本启动，首次主窗口未前置，使用现有 second-instance 激活后实际界面与 MCP 均确认 1.0.86。Root User 托管会话、三家店铺记录保留；两家拼多多均在线，两个识图开关均保持开启。米配匠 6 件商品、89 条待审核知识读回，旧 111/17 步任务保持 needs-confirmation、revision=4，新增 8 步学习任务保持 succeeded。

店口五金店运行时提示“登录身份未能核实”，AI 尚未恢复；其已保存的恢复意愿仍在，未绕过现有身份门强开。米配匠 AI 已按保存意愿恢复。此状态属于既有身份保护，不把“记录保留”表述为两店 AI 都已开启。相关两份 AGENTS 的未提交修改已按 SHA256 确认原样保留。

本轮不制作安装包，不发布、不部署，不重试旧 111/17 步任务。添加店铺简化候选属于另一任务，未混入本次代码。最终启动证据为 `source86-acceptance.json` 与 `source-1.0.86.png`。

## 证据

`artifacts/training-clone-fix-20261119/`：DeepSeek task/events/exit/HANDOFF、red/green、typecheck/lint/prettier、build/main-build、native-initial/native、native-result.json、native-three-rounds.png。保留执行和初次失败证据。
