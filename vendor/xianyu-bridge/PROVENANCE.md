# 闲鱼页面桥接脚本来源

`bridge.js` 复制自第三方参考实现；本项目只做了一处时间标签兼容补丁，其余保持原样。

| 项目 | 值 |
| --- | --- |
| 来源路径 | `F:\shanhui-app\kb-port\bridge\bridge.js`（用户提供的 kb-port 工程） |
| 参考文档 | `F:\shanhui-app\kb-port\XIANYU-INTEGRATION.md` |
| 桥版本 | v59 |
| 字节数 | 447941 |
| SHA-256 | `487319969713a133484c13b7d7807f599119ff7245a867fb80ba8a554c85b220` |
| 复制日期 | 2026-11-16 |

## 本地兼容补丁

2026-11-17：`isTimeLabel` 原先只认 `HH:MM`，闲鱼真机的「昨天 21:47」「11-05 21:31」等分组标签读不到，消息时间全部回退为当前时间，导致 AI 把旧消息当成新上下文。现补充带日期、路径时间和相对时间（`N分钟前`）的标签识别；时间换算仍由本工程 `electron/xianyu/adapter.ts` 的 `xianyuTimestamp` 完成。未改动消息读取、方向判定和网络钩子。

## 用途与边界

- 只注入到 `https://www.goofish.com` 页面；由 `electron/xianyu/bridge-client.ts` 注入并接管
  `window.ipc.postMessage` 消息通道。
- 脚本遵守上游纪律：不替换 `window.WebSocket`，只旁听 MTop/XHR 响应；自检失败会自行卸载钩子。
- 宿主侧适配器（`electron/xianyu/adapter.ts`）是本项目 TypeScript 实现，不修改本文件。

## 许可证

来源工程 `kb-port` 的 `package.json` 标注 `"license": "UNLICENSED"`，未随附独立许可证。
本副本仅用于用户已授权的本机对接；在公开发布安装包、对外分发或商用交付前，必须先核实该脚本的再分发授权，
不得以本项目许可证替代。

校验命令：

```bash
sha256sum vendor/xianyu-bridge/bridge.js
```
