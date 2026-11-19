# Windows 主目录构建环境

## 不构建的手动源码入口（2026-11-19）

双击根目录 `启动源码（不构建）.bat`，启动脚本的 `-NoBuild` 分支只运行 Vite 与已有 `dist-electron`，不会执行 npm 安装、build 或打包。使用应用默认的原账号/知识数据目录，不新建隔离资料。Electron 与 Vite 输出直接写入 `artifacts/source-live/<时间>/`，避免继承断开的终端日志管道；控制台关闭会结束本次进程树。必须先退出原源码实例和开发服务，脚本不会终止未知的端口占用进程。主进程源码更改须另行构建才能应用。

以下为历史构建环境修复记录，不表示本次执行过构建。

2026-11-17 已修复主目录 `npm run build` 的 esbuild 临时文件权限错误，并验证主目录 `npm start` 正常构建、启动。软件版本保持1.0.46；这是本机文件系统完整性标签修复，没有修改业务代码或依赖。

## 根因及证据

主项目父目录带有可继承的 Windows Low Mandatory Level。主目录的 esbuild、Electron 可执行文件因此继承低完整性标签。普通 Node 进程创建的临时文件处于正常完整性级别，低完整性 esbuild 服务进程不能删除这些临时文件；放宽普通读写权限或改换临时目录不能解决该完整性级别冲突。

本机对照：主目录与可用工作树的Vite esbuild均为0.21.5，可执行文件SHA-256相同。使用同一个Node、相同当前目录和相同2MiB有效JavaScript输入，主目录二进制报 `remove .../esbuild-<hash>: Access is denied`，工作树二进制成功。仅将主目录该二进制的完整性标签恢复为Medium后，相同输入立即成功。

参考：[Microsoft Mandatory Integrity Control](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)、[Microsoft icacls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)。DeepSeek Harness上游有[相同标签污染机制的报告](https://github.com/deepseek-ai/deepseek-harness/discussions/8314)，本机因果判断以实际ACL与单变量对照为依据，不把报告当作本机证据的替代。

## 已执行修复

核对绝对目标为本项目 `client` 主目录后，用Windows原生 `icacls` 设置本目录的可继承Medium完整性标签：

```powershell
# 仅在已确认是本项目主目录时执行，避免对其他工作区操作。
icacls . /setintegritylevel '(OI)(CI)M'
```

作用范围为本项目主目录及继承此标签的后代。没有改动外层其他项目；修复前后主目录DACL的SDDL逐字一致，已有普通读写授权未改变。主目录的两个esbuild版本及Electron二进制均已核对为Medium，新建文件也继承Medium。系统TEMP/TMP保持原值。

后续写入型代理任务使用独立Git worktree，避免沙箱grant再次覆盖日常主目录的完整性标签。若复发，先比较可执行文件、项目根及临时文件的实际完整性标签；不要用修改业务构建逻辑来掩盖环境错误。

## 验收

- 修复前完整构建失败、2MiB transform失败；修复后相同transform成功。
- 主目录默认环境执行 `npm run build` 返回0，Vite与Electron主进程构建均成功。
- 主目录执行 `npm start -- --inspect=127.0.0.1:9237`，标准start脚本重新构建后成功启动本目录内的Electron；额外参数只用于本次读取运行版本，没有修改启动脚本或替换运行时。
- 运行时实际返回版本1.0.46、appPath为主目录、executable为主目录的 `node_modules/electron/dist/electron.exe`，存在可见窗口。临时调试监听在核验后关闭，应用继续运行。

本机ACL快照、构建/启动日志及运行时JSON位于 `E:/codex-builds/lingtu-esbuild-diagnostics-20261117`。未重新打包、发布或部署生产；没有对真实买家执行操作。
