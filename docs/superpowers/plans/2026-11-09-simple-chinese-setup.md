# 中文简易配置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 管理员在中文页面选择 DeepSeek 或千问，只粘贴密钥并保存，即可供客户端使用。

**Architecture:** 继续复用 New API 的 Card/Input/Button、管理员身份验证、单次安全确认和固定模型渠道。默认只显示三步模型设置，其余现有功能收进折叠区；保存模型及切换默认模型在同一服务端事务中完成。沿用用户已指定的灵兔风格，无需再次确认布局。

**Tech Stack:** 现有 React/TanStack Query、原生安全确认组件、Go/GORM、固定版本 New API。

- [x] `admin-page.tsx`：固定中文、三步配置、每厂商独立未保存草稿、状态与官方获取入口、中文安全确认说明；高级功能保留。
- [x] `lingtuhost/admin.go`：可选 `make_default`，保存密钥、渠道能力及默认模型原子提交；原有高级请求兼容。
- [x] 针对性测试：英文浏览器仍为中文、未保存密钥不误用、默认折叠、一次受保护保存、事务失败不留下半配置。
- [x] 独立审查、本地检查、GitHub 三数据库和前端构建；不读取真实密钥进行测试。
- [x] 下载同次产物，备份后部署大陆后端及两端同一前端产物；保留账户、密钥、会话及回滚版本。
- [x] 不强制刷新有未保存密钥的页面。向用户交付直接可用的中文页面，真实凭据由用户在页面输入。
