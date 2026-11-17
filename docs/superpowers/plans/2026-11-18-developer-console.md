# 回复监控开发调试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task with failing tests first. 用户已批准设计，Codex负责环境、复核、集成及验收，本机DeepSeek负责独立工作树实现。

**Goal:** 左下统一回复监控入口，在同一源码监控窗展开GM和真实交互CMD，打包版无开发功能。

**Architecture:** 复用现有回复监控单例子窗及runtime业务状态；新增源码专属主进程控制器、GM注册表、PTY宿主及owner绑定的窄IPC。auxiliary模块通过platform适配器承载前端调试区，不触碰平台网页权限或发送批准流程。

**Tech Stack:** Vue3/Element Plus，xterm6.0.0、FitAddon0.11.0、官方node-pty1.1.0（开发依赖），Windows ConPTY。

**Spec:** ../specs/2026-11-18-developer-console-design.md（已批准）。

## Global Constraints

- 所有写入限当前独立worktree。禁止修改vendor/server、正式用户资料、原发送门、真实买家操作或公开发布。
- app.isPackaged为主进程权威：打包版不创建debug控制器、不注册debug IPC、不在preload暴露GM/CMD，不留flag开启。node-pty仅开发依赖，main esbuild external。
- 当前回复监控webContents主frame为唯一调试owner；不能只检查“任意本应用页面可信”。会话还绑定工作区。renderer不接任意IPC，不提供eval/exec网关给其他窗口或agent。
- 保留当前监控、跟随主窗、非全局置顶、showInactive、审核批准语义。展开/缩小不创建第二监控，不因新消息收起、不抢焦点。
- 编码TypeScript/严格类型及既有依赖方向；跨模块经index。只跑受影响检查；全量/打包验收交由标准CI或专门产物验收。

## Review Focus

源码/打包判定不能由渲染层或参数伪造；终端窗口关闭和工作区变化杀掉进程树；CMD Enter不进入批准操作；GM显式店铺绑定且不读密钥；乱序/迟到输出不进重建窗口；主窗resize不重置用户展开状态；弹窗默认处理可恢复且不污染后台采集页。

## Tasks

- [x] 1. 定义共享debug请求/响应/事件及平台client，先写schema和鉴权/会话归属失败测试；实现主进程源码gate、owner lease、窗口展开接口和装配/销毁。preload采用主进程提供的源码能力标志（不能靠renderer判断），打包版对象不暴露开发方法。既有公开API保持兼容。
- [x] 2. GM注册表与服务，先测试help/status/stores/logs边界及未知命令，再实现有界、脱敏、逐命令扩展。pdd-popup status/allow/block绑定显式storeId，仅本次运行；复用正确来源URL和嵌入view识别：BrowserWindow.fromWebContents(wc)可能返回父窗口，不能用===null判定；应比较owner.webContents!==wc并核对目标store真实WebContents。allow正常网页新窗，block恢复原默认外部打开+deny，无后台页面或其他平台副作用。
- [x] 3. node-pty服务，先使用注入fake测试会话/输出/resize/退出/权限，再用真实隔离Electron验证cmd.exe。支持持续会话cd/中文/方向键/Ctrl+C/退出、正尺寸、输出缓冲有界、清屏仅清显示、断开结束进程树。默认cwd=源码appPath；不自动启动，不提权。启动失败明确显示，不降级为假终端。
- [x] 4. UI和入口迁移，先写紧凑/源码/打包能力缺失及tab/按钮行为失败测试。主工作台右上移除；工作台和配置中心左下提供同一入口。展开960×620，左340回复+审批/高级日志，右GM/CMD；窄屏上下。选择店铺、GM输入/历史/输出分离；CMD连接/断开/清屏/状态/目录，xterm自动fit并向PTY resize。关闭清理，收起保留会话。通过module service/platform API，不直接调用Electron/Node。
- [x] 5. 文档与验收：新增docs/DEVELOPER_DEBUG.md，更新AGENTS/ARCHITECTURE/RUNTIME_LOGS/auxiliary README/HANDOFF/THIRD_PARTY_NOTICES，规定后续调试统一注册。新增隔离原生场景验证真实终端、GM、窗口状态、拒绝其他来源及打包gate。定向单测、Vue/Electron类型、修改文件lint/format和build。Codex独立审查后修正、合最新main、版本一次patch、推送CI、下载产物确认无debug后本机启动，最后重启主项目供用户查看。

## Implementation rulings

依赖安装、Node/Electron原生模块最小验证及package版本由Codex负责；DeepSeek不要运行npm install/ci或改版本。若需要额外源码文件按职责新增并报告；不要为了节省分析时间把主进程全部塞入local-runtime.ts，debug域保持独立。配置和密钥永不进入GM快照或自动日志。

## 最终验收回执（2026-11-18）

1.0.58 / fadc03d：CI 44137539038 全绿，169 文件/1268 项、原生桌面 91/91、知识库与来源学习和产物 10 项通过；下载校验三份 SHA256 匹配，同 ZIP 本机首次 10 项通过。正常主目录实例已重开并核对 v1.0.58、原 userData、临时端口关闭。详见 docs/1.0.58-acceptance.md。PDD 实店弹窗与真实发送仍未验证，未公开发布或部署。

## 最终验收

已合并并推送 main，版本 1.0.58。相关 14 文件 69 测试、类型/变更范围 lint/format/build、真实 CMD 与子进程清理通过；云端 Actions 44137539038 全流程通过（桌面 91/91）。下载产物的 manifest/三个 SHA-256 校验及隔离 package-smoke 通过。源码主目录已重启并在实际窗口确认 v1.0.58、GM status 与 CMD 连接。未公开发布；PDD 实店主动新窗口行为未触发验收。
