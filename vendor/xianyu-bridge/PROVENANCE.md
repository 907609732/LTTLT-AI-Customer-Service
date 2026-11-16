# 闲鱼页面桥接脚本来源

`bridge.js` 为原样复制的第三方参考实现，不是本项目自写代码，也没有经过本项目修改。

| 项目 | 值 |
| --- | --- |
| 来源路径 | `F:\shanhui-app\kb-port\bridge\bridge.js`（用户提供的 kb-port 工程） |
| 参考文档 | `F:\shanhui-app\kb-port\XIANYU-INTEGRATION.md` |
| 桥版本 | v59 |
| 字节数 | 447438 |
| SHA-256 | `97ddde7ba171f75b5d3953f5aea281f8aa3be0150f995cde5e4d9a68a796335b` |
| 复制日期 | 2026-11-16 |

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
