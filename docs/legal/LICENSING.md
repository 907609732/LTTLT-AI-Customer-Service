# 许可说明：Apache-2.0 原创代码与混合许可边界

项目：LTTLT-AI-Customer-Service（灵兔 AI 电商客服）<br>
维护账号：[907609732](https://github.com/907609732)<br>
生效日期：2026-11-17

## 一、根许可证与适用范围

根目录 [LICENSE](../../LICENSE) 是未经改写的 **Apache License 2.0** 标准文本。该许可证只适用于 [LICENSE_SCOPE.md](LICENSE_SCOPE.md) 明确列入“Apache-2.0 覆盖范围”、由项目权利人拥有且有权重新许可的原创代码和文档。

**本仓库不是整体 Apache-2.0 项目。** 根许可证不覆盖：

- `server/` 中导入或派生的 New API 服务端；
- `vendor/lingtu-runtime/` 的固定客户端运行时；
- 第三方依赖、字体、测试夹具、平台图标、截图、设计导出物和其他第三方素材；
- 来源或权属未确认的外部贡献、历史还原代码及素材；
- 项目名称、Logo 和第三方商标。

逐路径范围和排除项以 [LICENSE_SCOPE.md](LICENSE_SCOPE.md) 为准。根目录换成 Apache-2.0 不等于整个组合程序已脱离 AGPL，也不代表可以闭源交付含 AGPL 组件的版本。

## 二、Apache-2.0 已授予的权利

对确实属于 Apache-2.0 覆盖范围的原创材料，任何取得副本的主体均可依 Apache-2.0 使用、复制、修改、分发和商业使用，包括在履行许可证条件的前提下进行闭源集成或销售。无需仅因 Apache-2.0 已授予的这些行为另行购买商业许可。

分发时须遵守 Apache-2.0 第 4 条等适用条件，包括提供许可证副本、保留适用的版权、专利、商标和归属声明、在修改文件中作出显著修改说明，并在存在适用 `NOTICE` 时保留其内容。具体权利义务以 `LICENSE` 原文为准。

根 Apache-2.0 不授予商标权，不替代第三方许可，也不对未列入覆盖范围的材料作出任何许可。Apache-2.0 第 9 条允许在符合条件时提供额外保证或责任承担，但本仓库没有凭空作出此类承诺。

## 三、AGPL 组件与其他单独许可

### `server/`

`server/` 是导入并维护的托管服务端，包含 [QuantumNous/New API](https://github.com/QuantumNous/new-api) 派生代码，适用 **AGPL-3.0-or-later**。固定上游版本为 `v1.0.0-rc.49`，提交 `48a6c87f9e7757fdc58e5be9bcb4f8281ad0dfd0`。上游版权归 QuantumNous 及相应贡献者；本地修改和对应源码记录见 `server/PROVENANCE.md`、`server/upstream.lock.json` 和本仓库源码。

`server/` 不纳入根 Apache-2.0。分发服务端、其修改版本或通过网络提供交互时，仍须按 AGPL 履行适用义务，包括在要求范围内提供对应源码和安装信息。仅提供上游链接、仅隔离客户数据或仅公开桌面客户端源码，不能当然替代这些义务。

### `vendor/lingtu-runtime/`

该目录保留固定来源的客户端运行时，适用 **AGPL-3.0-only**。上游来源为 [PR #18](https://github.com/907609732/LTTLT-AI-Customer-Service/pull/18)，固定提交 `5b6293cc9c75e6e25fdaa16d6187effb0a9d1a5e`；完整许可、来源和本地兼容补丁见该目录的 `LICENSE`、`LICENSING.md`、`PROVENANCE.md` 和 `source-files.json`。本仓库没有把这些文件改成 Apache-2.0，也没有改写其许可文本或来源清单。

### `vendor/xianyu-bridge/`

该目录的来源工程 `kb-port` 曾在 `package.json` 中标注 `"license": "UNLICENSED"`，未随附许可文本。2026-11-17 用户确认该参考工程代码由其本人所有并授权公开分发。依照该项确认，本维护副本（包括未改动字节的 `bridge.js`）按同目录 [LICENSE](../../vendor/xianyu-bridge/LICENSE) 的 Apache-2.0 提供；来源工程的历史 `UNLICENSED` 标注继续作为历史事实保留在 `PROVENANCE.md` 中，不追认或改写来源工程过去的许可状态。

### 第三方依赖、素材和字体

npm 依赖、MCP SDK、Mammoth 测试文档、Noto Sans SC 字体、平台图标、截图、Figma 导出物、历史还原素材及其他第三方材料分别适用其自身条款。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和实际依赖包随附的许可。根 Apache-2.0 不能授予项目无权授予的权利。

客户聊天记录、账号凭据、支付密钥、数据库和私有运行配置不随公开源码发布；但**数据隔离不是源码合规的替代方案**。如适用许可证要求提供对应源码、安装信息或其他材料，仍须独立履行。

## 四、商业合作

[COMMERCIAL_LICENSE.md](COMMERCIAL_LICENSE.md) 仅是企业服务、部署支持、定制开发、OEM/品牌合作和服务等级（SLA）的谈判模板，不是软件许可，也不是 Apache-2.0 的附加条款。

- Apache-2.0 已授予的商业使用、修改、分发和闭源集成权利不因本文件而被收费、限制或要求另行购买。
- 企业服务可以就部署、维护、培训、定制、SLA、品牌/OEM 等额外服务收费，但只能提供授权方确实有权提供的权利和服务。
- 商业合作不豁免 AGPL、第三方许可、字体许可、商标或其他权利人的条件。
- 仅下载、浏览、fork、使用软件或提交询价，不构成对企业服务合同的接受；合同须由双方有权代表另行签署并满足约定生效条件。

## 五、既有许可与贡献

本次许可证调整不撤回此前版本中依 AGPL-3.0-only、AGPL-3.0-or-later 或其他有效许可证已经授予的权利。已经合规取得的副本、修改权和分发权继续按当时适用的许可处理；本次变更只影响明确纳入 Apache-2.0 范围的材料在后续版本中的许可声明。

外部贡献者保留其合法权利。无书面再许可依据的外部贡献不自动纳入 Apache-2.0，也不得被商业服务合同或仓库管理权限自动改为闭源许可。贡献规则见 [CONTRIBUTING.md](../../CONTRIBUTING.md)；Git 提交作者、合并操作或账号权限不替代权属和授权证明。

## 六、权威文本与来源

- [Apache License 2.0 标准文本](../../LICENSE)
- [Apache License 2.0 官方页面](https://www.apache.org/licenses/LICENSE-2.0)
- [GNU AGPL v3 标准文本](https://www.gnu.org/licenses/agpl-3.0.html)
- [QuantumNous/New API](https://github.com/QuantumNous/new-api)
- [本项目仓库](https://github.com/907609732/LTTLT-AI-Customer-Service)
- [许可范围矩阵](LICENSE_SCOPE.md)
- [第三方内容与权利说明](THIRD_PARTY_NOTICES.md)

本说明是项目许可边界的说明性文件，不构成法律意见，也不证明所有文件、贡献、素材或组合程序已经完成权属核验或取得普遍的法律合规认证。具体适用以各许可证原文、有效书面授权和适用法律为准。
