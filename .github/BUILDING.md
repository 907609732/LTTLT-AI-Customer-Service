# 云端构建与发布附件

本目录位于灵兔 AI 独立仓库根目录，与 `package.json`、`src/`、`electron/` 同级。工作流从仓库根执行，不依赖旧工作区路径。

## 工作流

| 工作流                                                    | 触发方式                                       | 作用                                                                                                  |
| --------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| [Windows 桌面构建](workflows/lingtu-ai-desktop.yml)       | 手动、Pull Request、推送 `main`                | 完整源码检查、真实桌面验收、知识库专项、NSIS/ZIP 打包、成品启动验收、清单与校验值生成、Artifacts 上传 |
| [已验证发布附件上传](workflows/lingtu-release-assets.yml) | 仅手动                                         | 校验已有草稿 Release、成功构建记录和确切源码，再上传已验证附件                                        |
| [托管服务验证](workflows/lingtu-server.yml)               | 手动、Pull Request、`main` 上 `server/**` 变更 | MySQL/PostgreSQL 服务测试、Windows 本机服务预览构建与校验文件                                         |

## 桌面构建

`lingtu-ai-desktop.yml` 使用 Windows 与 Node.js 24，依次执行：

1. `npm ci` 安装锁定依赖。
2. `npm run check` 检查类型、格式、依赖边界、供应商摘要、单元测试、上游回归和源码构建。
3. `npm run test:desktop` 运行真实 Electron 桌面验收。
4. 运行知识库管理与资料学习专项验收。
5. 使用 `electron-builder --config config/electron-builder.json --win nsis zip --x64 --publish never` 构建 NSIS 安装程序和 ZIP。
6. 启动打包后的真实程序执行成品验收。
7. 从 `package.json` 读取版本，生成 `RELEASE-MANIFEST.json` 与 `SHA256SUMS.txt`，记录确切源码提交和本次构建地址。

| 产物                              | 内容                                               |
| --------------------------------- | -------------------------------------------------- |
| `lingtu-ai-windows-<commit>`      | NSIS 安装程序、ZIP、版本清单及 SHA-256             |
| `lingtu-ai-verification-<commit>` | 桌面、打包与知识库专项验收证据，以实际上传文件为准 |

产物位于对应 Actions 运行记录的 **Artifacts**，保留 30 天。下载与本机校验方法见[打包说明](../docs/PACKAGING.md)。

该工作流使用只读 `contents` 权限，打包参数为 `--publish never`，不会创建 GitHub Release，也不会部署服务。推送或合并触发构建，不代表公开发布安装包。

## 已验证附件上传

`lingtu-release-assets.yml` 只允许手动触发，必须输入已有草稿 Release 的 tag、成功的桌面构建 run ID 和确切源码 SHA。工作流仅在 `main` 上运行并校验：

- tag 格式、源码提交与 tag 指向一致。
- 指定构建运行成功、来自桌面工作流，且提交 SHA 一致。
- 目标 Release 已存在且仍为草稿。
- 下载的附件集合、`RELEASE-MANIFEST.json` 版本/源码/构建地址与 tag、源码 SHA 一致。
- `SHA256SUMS.txt` 中的每一项都与实际文件重新计算的 SHA-256 匹配。

校验通过后，只把安装程序、ZIP、清单和校验文件上传到该草稿 Release；不会把草稿改为公开，也不会创建新的 Release。公开发布仍需单独、明确的人工操作。不要把该流程用于覆盖已公开版本。

## 权限与数据边界

- 桌面构建为只读 `contents`；发布附件上传只为读取 Actions、写入指定草稿 Release 使用短期 `GITHUB_TOKEN`，不新增长期密钥。
- 托管服务工作流为只读，只产出 Windows 本机预览构建和验证证据，不随桌面安装包分发。
- 不要在工作流、产物或日志中写入仓库账号、服务端管理员密码、模型 Key、Cookie 或业务数据。
- GitHub Actions 产物是开发构建；已发布版本的源码、附件与验收边界以[发布验收记录](../docs/RELEASE_V1.0.37.md)为准。
