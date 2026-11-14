# 云端构建配置

本目录位于灵兔 AI 独立仓库根目录，与 `package.json`、`src/`、`electron/` 同级。工作流从仓库根执行，不依赖旧工作区路径。

## 触发方式

[Windows 桌面构建](workflows/lingtu-ai-desktop.yml)支持以下触发方式：

- 手动运行（`workflow_dispatch`）。
- Pull Request。
- 推送至 `main`。

## 构建流程

工作流使用 Windows 与 Node.js 24，依次安装锁定依赖、执行全量项目检查与桌面验收、构建 NSIS 安装包和 ZIP，并启动打包后的 EXE 验收。最终记录源码提交、构建地址及 SHA-256 校验值。

## 产物与下载

| 产物                              | 内容                                    |
| --------------------------------- | --------------------------------------- |
| `lingtu-ai-windows-<commit>`      | Windows 安装包、ZIP、版本清单及 SHA-256 |
| `lingtu-ai-verification-<commit>` | 桌面与成品验收证据，以实际上传文件为准  |

产物位于对应 Actions 运行记录的 **Artifacts**，保留 30 天。下载与本机校验方法见[打包说明](../docs/PACKAGING.md)。

## 权限与发布

工作流使用只读 `contents` 权限；打包参数为 `--publish never`，不会自动创建 GitHub Release。推送或合并触发构建，不代表公开发布安装包或部署生产服务。

不要在工作流或产物中写入仓库账号、服务端管理员密码、模型 Key 或业务数据。
