# 还原流水线（可复现）

本文记录从 Electron 安装包到可维护 Vue 源码工程的完整步骤。所有工具都在
`F:\Setupgod\YunDuoAi\_re-tools`，中间产物在 `_re-tools\out\`。

## 0. 输入

```
F:\Setupgod\YunDuoAi\
├─ resources\app.asar           # 71.7 MB，应用主包
└─ _re-tools\                   # 本流水线的工具与产物
```

应用信息：Vue 3.5.11 + Element Plus 2.8.8 + Pinia + Vue Router 4，
源码经 Vite 打包为 ESM chunk，再用 `javascript-obfuscator` 处理字符串表。

## 1. asar 解包

```bash
node _re-tools/asar-extract.js
# 产物: _re-tools/unpacked/
#   out/main/index.js        主进程（esbuild，未混淆）
#   out/preload/index.mjs    preload
#   out/renderer/            Vue 渲染层（29 个 chunk）
```

## 2. AST 级脱混淆

```bash
node _re-tools/deobf-ast.js <in.js> <out.js>   # 单文件
```

批量脚本（本工程实际使用）：

```bash
cd _re-tools
mkdir -p out/renderer-ast
for f in unpacked/out/renderer/assets/*.js; do
  node deobf-ast.js "$f" "out/renderer-ast/$(basename "$f")"
done
npx prettier --parser babel --write out/renderer-ast/*.js
```

要点：

- 在 `vm` 沙箱里执行样本自带的字符串解码器，拿到 `index → string` 映射；
- 只替换 **CallExpression** 节点，绝不改动字符串内容（避免文本替换造成的引号错配）；
- 多段字符串拼接需要反复折叠（`a+b+c` 先折内层）。

## 3. 组件抽取

```bash
node _re-tools/extract-components.js
# 产物: out/components/*.render.js / *.setup.js / *.meta.json
#       out/components-index.json
```

识别规则：顶层 `const X = { __name, setup(){...} }`，以及
`wrapper(X, [["__scopeId","data-v-xxx"]])` 形式的包装绑定。
`setup()` 返回的渲染箭头函数可能藏在 `SequenceExpression` 最后一项里。

## 4. 导入/导出/图标映射

```bash
node _re-tools/build-maps.js
# 产物: out/export-map.json / out/import-maps.json / out/icons.json
```

- 解析 index chunk 的 `export { local as a4 }`，把各视图里的压缩别名还原成组件/图标/资源；
- 提取 68 个内置 SVG 图标（`__name` 为 kebab-case 且 render 含 `<svg>`）；
- 识别 `new URL("xxx.png", import.meta.url)` 形式的静态资源。

## 5. render 函数 → SFC

```bash
node _re-tools/render-to-sfc.js [组件名或ID...]
# 产物: out/sfc/*.vue
```

转换器做这些事：

| 编译期调用                                            | 还原为                                     |
| ----------------------------------------------------- | ------------------------------------------ |
| `createElementVNode(tag, props, children)`            | 普通元素 + 属性/事件                       |
| `createElementBlock(Fragment, null, renderList(...))` | `<template v-for>`                         |
| `createVNode(comp, props, slots)` / `createBlock`     | 子组件 + 默认/具名插槽                     |
| `createTextVNode(x, 1)` / `toDisplayString(x)`        | 文本 / `{{ x }}`                           |
| `createCommentVNode("v-if", true)`                    | `<!--v-if-->`（条件分支占位）              |
| 条件表达式 / `&&`                                     | `<template v-if>` / `v-else-if` / `v-else` |
| `withDirectives(vnode, [[vShow, x]])`                 | `v-show`                                   |
| 提升的静态 vnode 常量                                 | 直接内联该 vnode                           |
| 未知动作                                              | `@click="__stub('...')"`                   |

表达式处理原则：

- 静态可求值的数组/对象/字符串 → 原样内联（例如首页的平台列表、动作卡片）；
- `unref(x)` / `x.value` → 直接使用绑定；
- 成员访问 → 可选链（`a?.b`），未知调用 → `__invoke(fn, ...)`，保证 mock 不完整时也不崩；
- 无法安全翻译的编译期标识符 → 丢弃该属性，交给占位层。

## 6. 外壳校正（源码级增强）

自动还原会得到 66 个可用组件，但应用外壳需要人工语义：

- `patch-mainlayout.js`：给 `MainLayout.vue` 注入 `useRouter`、顶部导航跳转、
  窗口最小化/最大化/关闭、侧栏折叠、设置/充值入口；
- `finalize-views.js`：修正二维码资源、Dashboard/登录页跳转、顶部文案、
  空店铺态、弹窗默认关闭；
- `src/views/MainLayout.vue`、`src/views/ShopManageView.vue` 为手写/校正后的外壳；
  配置中心的菜单结构（`Jl` / `VISIBLE_NAV_GROUPS`）与面板映射来自原应用。

## 7. 装配与验证

```bash
# 组件/样式/资源落位
cp out/sfc/*.vue yunduo-ui/src/components/
cp unpacked/out/renderer/assets/*.png yunduo-ui/src/assets/
cp unpacked/out/renderer/assets/*.css yunduo-ui/src/styles/

# 构建
cd yunduo-ui && npm run build

# 逐路由冒烟 + 截图
npx electron electron/smoke.cjs
# 产物: _re-tools/out/shots/*.png + report.json
```

冒烟测试逐路由加载 `dist/index.html#/route`，收集 `window.__vueErrors`
与 `console.error`，并截图。当前 13 个路由全部零运行时错误。

## 8. 样式保真说明

- 原始 CSS 全量保留（`index-Bo8MNrq9.css` + 各视图 CSS），不重写、不压缩；
- 模板元素保留原 `data-v-*` 属性，scoped 选择器直接命中；
- `static vnode` 中的 HTML 片段在注入时自动补齐 `data-v-*`；
- 图标由原包的 SVG path 生成独立组件，颜色使用 `currentColor`。

## 9. 当前开发入口

以上记录描述原始还原阶段，旧组件目录、运行脚本及测试输出路径已调整。当前维护以 README、CONSTRAINTS、ARCHITECTURE 和 HANDOFF 为准。

不要运行历史生成器覆盖当前源码；不要把占位提示函数改成业务请求。真实接入应通过模块契约和服务，在 app 中装配实现。
