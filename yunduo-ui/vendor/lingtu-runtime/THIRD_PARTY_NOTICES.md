# 第三方内容与权利说明

本文件说明项目许可的边界，不是完整的软件物料清单，也不替代各第三方包随附的许可证。

## 软件依赖

### 托管账号与模型服务

`managed-server/` 复用 [QuantumNous/New API](https://github.com/QuantumNous/new-api)，固定版本为 `v1.0.0-rc.49`、提交 `48a6c87f9e7757fdc58e5be9bcb4f8281ad0dfd0`。上游版权属于 QuantumNous 及相应贡献者，上游许可为 **AGPL-3.0-or-later**；不受本项目单独商业授权覆盖。保留上游文件版权、LICENSE 和界面归属。新增覆盖层及构建说明见 `managed-server/README.md`；构建产物附上上游完整 LICENSE，运行界面提供修改版源码入口。

项目各开发分支的 `package.json` 和 `package-lock.json` 记录其实际依赖版本。它们可能包括 React、React DOM、Lucide、Electron、Vite、TypeScript、Playwright、electron-builder，以及 Figma 重构分支中的 [openfig-core](https://github.com/OpenFig-org/openfig-core)。

这些依赖及其传递依赖分别适用自己的许可证。锁文件中出现 MIT、ISC、BSD、Apache-2.0、MPL-2.0 等不同许可；不能将所有依赖一概声明为 AGPL 或本项目自有代码。锁文件的元数据也不能替代实际包中的许可证全文。

发布源码、安装包或其他构建产物时，须根据实际包含的组件、版本和分发方式保留其要求的版权、许可、NOTICE、源码提供或其他材料。项目商业授权不豁免这些义务。

## 图片、设计及平台标识

相关分支中的 `public/assets/`、`public/figma-assets/`、`docs/*preview*.png` 以及生成的设计数据，可能包含项目原创材料和第三方平台图标、商标或其他素材。

第三方平台标识及素材的权利属于其相应权利人。包含于仓库、从 Figma 或原型导出、或用于界面演示，均不能证明项目已取得再授权资格。项目的软件许可不授予第三方商标权，也不表示获得相关平台的官方认可。

项目名称和标识的商标权与代码著作权分别处理。描述项目来源等法律允许的合理使用不受本声明限制。对来源或授权范围尚不明确的素材，正式再分发或商业交付前应核实授权，必要时取得许可或使用有权使用的替代素材。

## 随附字体

`public/fonts/NotoSansSC.ttf` 为 Google Fonts 分发的未修改 Noto Sans SC 可变字体，来源：https://github.com/google/fonts/tree/main/ofl/notosanssc 。字体采用 SIL Open Font License 1.1，完整版权与许可随附于 `public/fonts/OFL.txt`，必须随应用产物保留。字体家族名保持 Noto Sans SC，供离线客户端与云端验收使用。

## 外部贡献与商业交付

商业许可只能覆盖授权方拥有或取得有效再许可权的材料。贡献者保留其合法权利；仅按 AGPL 获得的贡献不得直接推定为可闭源再许可。维护者须按 [CONTRIBUTING.md](CONTRIBUTING.md) 核实相应授权。

若具体文件含有更具体的第三方许可或权利声明，应保留并遵守该声明。发现缺失或错误的来源信息时，可在本仓库提交仅包含必要公开信息的 Issue，由维护者核实更正；不要公开上传未授权的私密材料。

