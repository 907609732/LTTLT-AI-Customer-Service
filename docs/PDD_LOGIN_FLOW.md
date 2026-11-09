# 拼多多添加与登录流程

确认添加拼多多网页店铺后，前端发送 `add-store` 与 `openAfterAdd:true`，直接创建空名称记录并打开独立会话的平台登录页。首页在后台更新，不抢走登录窗口焦点。其他平台维持原添加方式。

登录前展示待登录占位；登录后读取平台账号资料，保存店名、mallId、客服名和客服 ID。只保存这些身份字段，不保存账号响应、密码、Cookie 或 token。名称获取失败可点击“打开”或“重新获取店铺信息”重试，也会自动重试。

每店使用原有 `persist:desk-store-<id>` 会话。首次可优先读取已知页面账号容器，此后每 5 秒强制实时核验；导航后重新识别。HTTP 401 或登录页判未登录；网络故障/403 视为未知，保留上次已知状态并展示读取错误。登录状态与适配器连接状态分别记录。

页面加载失败与崩溃后，“打开”会重新加载。关闭、导航和删除使在途身份结果失效；退出登录和切换账号关闭 AI，并取消仍在进行的 AI 开启操作。切换 mallId 时清除旧名称与客服身份，避免串店显示。开窗失败保留已创建记录，可从首页重试，不需重复添加。

## 复用与来源

- 复用已安装 Electron 45.2.3 与项目 ShopWindowManager、StoreRegistry、平台 adapter、消息监控器；无新增依赖。
- Electron 官方 [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view) 与 [session](https://www.electronjs.org/docs/latest/api/session) 文档核对会话隔离和生命周期。
- GitHub [ai-customer-reception 平台示例](https://github.com/Geek-master-100/ai-customer-reception/blob/main/src/platform/pdd.js) 与 [pdkbot 平台示例](https://github.com/renchengxiaoqiang/pdkbot/blob/master/src/Platform/pdd.js) 用于交叉核对 `/chats/userinfo/realtime?get_response=true` 和 mall/username 字段。许可证与长期接口兼容性无法保证，因此未复制代码或引入这些项目；平台解析独立实现并测试。

## 验证 2026 年 11 月 9 日

- 类型检查与生产构建通过；构建仍有原有大包和静态/动态导入提示。
- 单元测试、平台后端测试、针对性页面测试通过，详细计数见本次任务结果。
- 真实 Electron 受控联调：界面确认添加、独立平台登录页、同会话账号 GET、店名/客服更新、磁盘保存、重试与退出登录、AI 关闭均通过；并检查登录窗口保持前台。
- 真实拼多多只读检查：确认添加后实际跳转 `https://mms.pinduoduo.com/login/`，未登录状态正确，账号登录页可展示密码输入框。未填写凭据、扫码登录或向买家发送消息。
- 全量界面测试 127/128 通过；`product-entry.spec.ts` 中旧数据看板底部辅助快捷入口测试找不到 `I8839:5116;8801:793`。本次未改看板入口行为，未将该失败隐藏或标成通过。
- 真实账号验收补充：账号持有人已在普通启动模式完成扫码。平台返回店名、店铺 ID、客服名和客服 ID，均自动写入本地注册表；首页卡片与当前店铺选择器自动更新，显示已连接，AI 仍关闭。业务名称和标识未写入仓库文档。
- 本次普通启动确认无 inspect/远程调试参数，二维码正常显示，未观察到滑块弹窗；这是单次对照结果，不能据此判定平台风控的唯一触发原因。

未发布或安装新版本；本次修改保留了工作区已有其他改动。
