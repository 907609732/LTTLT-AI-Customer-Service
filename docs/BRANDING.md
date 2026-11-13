# 灵兔 AI 名称与兼容标识

产品统一名称为“灵兔 AI”（灵兔与 AI 之间一个空格）。当前项目根仍为 F:\Setupgod\yunduo-ui，本轮不移动目录；已获授权建立交付分支并合并 main，不公开发布安装包。历史来源、许可、旧验证证据和发布文件名按原记录保留，不篡改为新名称。

| 项目                             | 当前名称                                                    |
| -------------------------------- | ----------------------------------------------------------- |
| 界面、窗口、网页标题、模拟顾客页 | 灵兔 AI                                                     |
| npm package / productName        | lingtu-ai / 灵兔 AI                                         |
| Windows 程序                     | LingtuAI.exe                                                |
| 安装包                           | LingtuAI-Setup-<版本>-win-x64.exe                           |
| ZIP                              | LingtuAI-<版本>-win-x64.zip                                 |
| 云端工作流                       | .github/workflows/lingtu-ai-desktop.yml                     |
| 云端产物                         | lingtu-ai-windows-<提交号>、lingtu-ai-verification-<提交号> |
| 后台中文标题                     | 灵兔 AI 管理后台                                            |
| 后台英文名称                     | Lingtu AI                                                   |

src/shared/brand.ts 是主界面的产品名称入口。登录宣传位已使用新名称的图片，旧图备份在 artifacts/branding-before-20261114；图标保留原外观，当前文件名为 lingtu-ai-icon.png。原产品官网 URL 不作为灵兔 AI 官网继续打开，当前入口如实提示未接入，等待正式地址。

## 必须保留的兼容范围

electron/app-identity.ts 为默认启动返回原 appData/yunduo-ui-restored，main 在单实例锁前显式设置 userData；显式 --user-data-dir 优先，仍可隔离验收。不得因为 npm 名称或窗口改名而迁移、删除、重建店铺、会话、加密 Key、托管账号和平台登录数据。safeStorage 数据继续使用原目录。

安装 appId、window.yunduoDesktop 桥接契约、既有 yunduo-local 登录分区和 YUNDUO\_\* 兼容环境参数保持原值，避免破坏已安装程序及平台分区；这些内部标识不作为公开产品名展示。打包检查新增 LINGTU_PACKAGED_EXE 优先，仍兼容 YUNDUO_PACKAGED_EXE。远程 API/账号来源、协议路由与许可证不随品牌改名而替换。

server 的品牌修改保留覆盖层、上游原始摘要和本地摘要，不直接改 .upstream 后充当维护源码。现有本机服务和历史安装包不会因源码改名自动更新；本轮不修改运行中的服务或自动重发安装包。构建与验证结果见 VALIDATION.md。

截图检查发现原商务合作二维码内也含旧品牌；新联系方式未提供，因此当前仅显示待配置，不沿用原产品二维码或擅自填写号码。组件名 ContactQr\* 为兼容已有引用保留。
