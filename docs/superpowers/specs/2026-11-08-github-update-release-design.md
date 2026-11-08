# GitHub更新检查与首个Release

目标：启动后台检查本仓库稳定Release，保留首页“检测更新”手动入口；发现新版展示版本和GitHub下载入口。按本次检查更新范围实现，安装由用户从发行页下载安装包执行。

方案：复用electron-updater6（与electron-builder26配套）和GitHub provider，配置autoDownload=false、autoInstallOnAppQuit=false、禁用预发布/降级。自行请求GitHub API再比较版本也可实现，但会重复现成provider能力，因此采用已有库。检查在主进程，通过现有可信来源IPC向前端提供状态；只允许打开固定仓库Releases地址。

启动检查异步、去重、限时；无新版时保持安静，手动检查显示结果；网络失败或没有Release明确提示，不能当作最新版。开发/自动化测试默认不访问外网；发布后另外做真实Release检查验收。

首个Release版本v0.4.0。现有GitHub云端工作流新增NSIS安装包和latest.yml/blockmap产物，保留可运行目录。下载同次产物验证SHA-256、更新清单SHA-512和运行结果后，创建草稿Release、上传安装包/更新清单/便携ZIP/校验文件，最后发布。标记绑定已合并且与验收产物同树的提交，不进行本地生产打包。

验证：更新服务最新/新版/失败/超时/并发测试，原生入口和前端状态测试、既有回归，云端安装包和元信息检查。真实公开Release发布后检查启动自动查询与按钮手动查询，保留业务数据与AI默认关闭。
