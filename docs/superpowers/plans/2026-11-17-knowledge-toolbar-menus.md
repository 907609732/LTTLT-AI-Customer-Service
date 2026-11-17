# 知识库工具栏点击菜单 Implementation Plan

> **For agentic workers:** Use subagent-driven-development to implement this scoped UI change. No commit/push without a new user request.

**Goal:** 按用户给出的闪回截图，把知识库工具栏九按钮改成四入口，次级功能点击后显示。

**Architecture:** 复用已有 Element Plus 2.8.8 Dropdown 和原 manager controller；所有业务回调、禁用条件、范围与确认保持。无新依赖、IPC 或数据迁移。

**Tech Stack:** Vue3/TypeScript/Element Plus/Vitest。

## 设计与范围

用户明确选择参考软件的按钮分组与点击展开交互。保留白蓝主题，常显：蓝色导入商品∨、白色自己写一件、导出∨、备份∨。导入4项包含平台商品、本机归档聊天、学习本店通用资料、CSV/通用资料；通用tab导入入口自然改名。导出含JSON/CSV；备份含全库备份/恢复全库备份，沿用原范围不冒充单店备份。排除新增功能、暗色换肤或后端修改。

方案取舍：直接复用现有Element Plus菜单（MIT，锁定2.8.8，项目已有），不用新库或自写弹层。保留全部9入口常显无法解决用户要求；统一塞进一个更多菜单会降低分组可发现性。

## 执行

- [ ] 写行为回归：默认只见4按钮，点击才展开；分组菜单对应原业务动作，禁用操作不能执行；自己写一件保持原逻辑。
- [ ] 实现点击下拉，互斥、Esc/外侧关闭，切店/页签/视图/工作区关闭；窄屏搜索可换行、操作组紧凑不溢出。保留data-testid兼容。
- [ ] 测试真实组件交互与原manager回归；相关类型/静态检查，生产构建。
- [ ] 独立代码审查；隔离视觉验收正常/展开/窄屏，禁止操作真实导入、备份、恢复或学习。
- [ ] 版本升1.0.38、同步文档，自动重启源码并核实实际版本。

## 参考与证据

用户本机闪回0.1.120的截图与UI树显示四入口；备份截图显示点击后两个选项。REA绑定本机shanhui-app.exe SHA256 310f19a8bda9835112f04b9b5b9613c74b74102cf4d89034bc8d194751cf51cf，仅借鉴交互，未复制第三方源码。

组件参考 https://github.com/element-plus/element-plus 与 https://element-plus.org/en-US/component/dropdown.html，文档通过Context7核对，实际实现对照本机2.8.8能力。
