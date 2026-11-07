# 灵兔 · 本地设计交付插件

本插件只在用户主动运行时读取当前选中的 Figma 节点，并导出 JSON_REST_V1 图层结构及可选 PNG 预览。它不请求 Figma REST API，不访问网络，不修改设计文件。

## 首次安装（需要 Figma 分配插件 ID）

1. 打开 Figma Desktop，进入任意有编辑权限的 Figma Design 文件。
2. 选择 Plugins → Development → New Plugin...，创建 Empty 插件，名称可设为「灵兔 · 本地设计交付」。
3. Figma 会生成带有真实 `id` 的 manifest.json。复制该 ID 到本项目的 manifest.json，替换 `REPLACE_WITH_FIGMA_ASSIGNED_PLUGIN_ID`。
4. 在 Plugins → Development → Import new plugin from manifest... 选择本项目的 manifest.json。如果提示同 ID 的本地版本已存在，先在插件管理中移除临时版本，再导入项目版本。
5. 运行 Plugins → Development → 灵兔 · 本地设计交付。

## 使用

- 在画布中选中 1–20 个 Frame / Component / Instance / Component Set / Group。
- 运行插件并点击「导出选中画板」。
- 保存 JSON 快照，在 Electron 客户端「本地设计交付」页导入。
- 建议按 UX 编号分批导出，避免超过 20 MB 的快照上限。

## 边界

- Figma 的插件 ID 由 Figma 创建流程分配，不可随意编造。
- 插件是手动启动的本地 Classic Plugin，不是后台实时同步服务。
- 当前插件为只读导出；不提供画板自动改名、组件创建或 Auto Layout 写入。
- PNG 仅作视觉对照，图标、图片等生产资源需要另行导出为本地文件。
