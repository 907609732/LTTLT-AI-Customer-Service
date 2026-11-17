# 第三方内容与单独许可组件说明

本文件说明项目混合许可的边界，不是完整的软件物料清单，也不替代各第三方包随附的许可证。根目录 Apache-2.0 只覆盖 [LICENSE_SCOPE.md](LICENSE_SCOPE.md) 列明的原创材料；本文件中的组件不因仓库根许可证变化而改变许可。

## 软件依赖

### MCP接口

1.0.9采用官方[modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk)的`@modelcontextprotocol/server`2.4.0及其core依赖；验证使用`@modelcontextprotocol/client`2.4.0（开发依赖）。许可证为Apache-2.0，版权与完整许可保留在各包的LICENSE；分发连接器时通过extraResources附带server/core原许可证，不以本项目许可替代。Zod沿用项目已有依赖；MCP注册和协议传输复用官方SDK。

### 托管账号与模型服务（`server/`）

`server/` 复用 [QuantumNous/New API](https://github.com/QuantumNous/new-api)，固定版本为 `v1.0.0-rc.49`、提交 `48a6c87f9e7757fdc58e5be9bcb4f8281ad0dfd0`。上游版权属于 QuantumNous 及相应贡献者，上游许可为 **AGPL-3.0-or-later**；不纳入根目录 Apache-2.0，也不受本项目企业服务合同覆盖。保留上游文件版权、`server/LICENSE-LTTLT`、上游锁文件和界面归属。新增覆盖层及构建说明见 `server/README.md`、`server/PROVENANCE.md`；构建产物附上上游完整 LICENSE，运行界面提供修改版源码入口。

### 客户端固定运行时（`vendor/lingtu-runtime/`）

`vendor/lingtu-runtime/` 是固定来源的客户端运行时，适用 **AGPL-3.0-only**；不纳入根目录 Apache-2.0。上游来源为 [PR #18](https://github.com/907609732/LTTLT-AI-Customer-Service/pull/18)，固定提交 `5b6293cc9c75e6e25fdaa16d6187effb0a9d1a5e`。该目录的 `LICENSE`、`LICENSING.md`、`THIRD_PARTY_NOTICES.md`、`PROVENANCE.md` 和 `source-files.json` 保留来源、许可及本地补丁记录，不由根许可证改写。

项目各开发分支的 `package.json` 和 `package-lock.json` 记录其实际依赖版本。它们可能包括 React、React DOM、Lucide、Electron、Vite、TypeScript、Playwright、electron-builder，以及 Figma 重构分支中的 [openfig-core](https://github.com/OpenFig-org/openfig-core)。

这些依赖及其传递依赖分别适用自己的许可证。锁文件中出现 MIT、ISC、BSD、Apache-2.0、MPL-2.0 等不同许可；不能将所有依赖一概声明为 AGPL 或本项目自有代码。锁文件的元数据也不能替代实际包中的许可证全文。

发布源码、安装包或其他构建产物时，须根据实际包含的组件、版本和分发方式保留其要求的版权、许可、NOTICE、源码提供或其他材料。根 Apache-2.0 和企业服务合同均不豁免这些义务；业务数据与源码分离也不替代任何许可证要求的源码或安装材料。

## 图片、设计及平台标识

相关分支中的 `public/assets/`、`public/figma-assets/`、`src/assets/`、`docs/*preview*.png`、`docs/screenshots/` 以及生成的设计数据，可能包含项目原创材料、历史还原素材和第三方平台图标、商标或其他素材。这些素材不因仓库根许可证为 Apache-2.0 而纳入 Apache 覆盖范围。

第三方平台标识及素材的权利属于其相应权利人。包含于仓库、从 Figma 或原型导出、或用于界面演示，均不能证明项目已取得再授权资格。项目的软件许可不授予第三方商标权，也不表示获得相关平台的官方认可。

项目名称和标识的商标权与代码著作权分别处理。描述项目来源等法律允许的合理使用不受本声明限制。对来源或授权范围尚不明确的素材，正式再分发或商业交付前应核实授权，必要时取得许可或使用有权使用的替代素材。

## 随附字体

`public/fonts/NotoSansSC.ttf` 为 Google Fonts 分发的未修改 Noto Sans SC 可变字体，来源：https://github.com/google/fonts/tree/main/ofl/notosanssc 。字体采用 SIL Open Font License 1.1，完整版权与许可随附于 `public/fonts/OFL.txt`，必须随应用产物保留。字体家族名保持 Noto Sans SC，供离线客户端与云端验收使用。

## 外部贡献与商业交付

Apache-2.0 只覆盖权利人有书面依据的原创部分；企业服务合同只能覆盖服务方拥有或取得有效再许可权的材料。贡献者保留其合法权利；无书面再许可依据的外部贡献、按 AGPL 获得的贡献及 Git 作者无法证明权属的修改，不得直接推定为 Apache-2.0 或可闭源再许可。维护者须按 [CONTRIBUTING.md](../../CONTRIBUTING.md) 核实相应授权。

若具体文件含有更具体的第三方许可或权利声明，应保留并遵守该声明。发现缺失或错误的来源信息时，可在本仓库提交仅包含必要公开信息的 Issue，由维护者核实更正；不要公开上传未授权的私密材料。

## Knowledge document parsing (Task4, 2026-11-15)

The application directly uses the following already pinned dependencies; it does not embed an Open WebUI/FastGPT/LlamaIndex application or copy their source:

- PDF.js / pdfjs-dist 6.5.438 — Apache-2.0, Mozilla and contributors. https://github.com/mozilla/pdf.js . Worker, CMaps, standard fonts and WASM remain with the installed package. Its installed optional `@napi-rs/canvas` implementation supplies native raster rendering and image tiling.
- Mammoth 1.13.0 — BSD-2-Clause, Copyright (c) 2013 Michael Williamson. https://github.com/mwilliamson/mammoth.js . Two unmodified test documents are retained under `tests/fixtures/knowledge-ingestion`; their copyright and complete license accompany them in `MAMMOTH-LICENSE.txt`.
- read-excel-file 9.3.17 — MIT, https://github.com/catamphetamine/read-excel-file . Uses v9's all-sheets Node API.

Package licenses are retained in their installed distribution. Existing PapaParse, Zod and js-tiktoken are reused for CSV, schema validation and per-call token accounting respectively. All other new knowledge-ingestion fixtures are synthetic local test materials with no customer content.

## 源码开发调试依赖（2026-11-18）

源码运行可选用官方 [node-pty](https://github.com/microsoft/node-pty) 1.1.0（MIT，Microsoft Corporation 及贡献者）启动 Windows ConPTY，并用 [@xterm/xterm](https://github.com/xtermjs/xterm.js) 6.0.0 与 [@xterm/addon-fit](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-fit) 0.11.0（MIT，xterm.js 贡献者）显示终端。三者均声明为 devDependencies；node-pty 不进入安装包，esbuild 将其标记 external，源码窗口点击连接时动态加载。xterm 和 FitAddon 编译为前端异步资源，随构建物分发，但打包版没有加载它们的调试入口或桥接能力。分发源码或其他包含这些组件的构建物时，仍须保留各包随附的版权与完整 MIT 许可。`electron/developer-debug` 中本工程自有代码继续适用根许可证范围矩阵。

## jsonrepair 3.15.0 (knowledge model output)

Source: https://github.com/josdejong/jsonrepair . Unmodified package, ISC license. Used only behind a strict repair allowlist; original model responses remain available for review.

The ISC License

Copyright (c) 2020-2026 by Jos de Jong

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND ISC DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL ISC BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## 闲鱼页面桥接脚本（vendor/xianyu-bridge）

`vendor/xianyu-bridge/bridge.js` 来源为用户提供的本地参考工程 `F:\shanhui-app\kb-port\bridge\bridge.js`（上游桥版本 v59，原始副本 SHA-256 `97ddde7ba171f75b5d3953f5aea281f8aa3be0150f995cde5e4d9a68a796335b`）。当前文件不是未经修改的上游原件：本地先加入时间标签兼容（该阶段 SHA-256 `487319969713a133484c13b7d7807f599119ff7245a867fb80ba8a554c85b220`，447941 字节），再加入 `write` / `commit` / `pasteImage` / `confirmImageSend` 的最小同步校验（精确买家键、写入/粘贴前原有草稿、提交前正文）；当前副本 SHA-256 为 `24202b955203a89573084cd7d349a8ecd98c21725f6eba8c30a7e1d00371fb03`，452373 字节。来源、补丁和用途见 `vendor/xianyu-bridge/PROVENANCE.md`。

2026-11-17 用户确认：该参考工程代码由用户本人所有，用户可以公开分发。根据该项授权，本维护副本按 `vendor/xianyu-bridge/LICENSE` 的 Apache-2.0 标准文本提供；`bridge.js` 字节和 SHA-256 保持 `24202b955203a89573084cd7d349a8ecd98c21725f6eba8c30a7e1d00371fb03`，未因许可声明而修改。来源工程 `package.json` 的 `"license": "UNLICENSED"` 标注继续作为历史事实保留，不追认或改写来源工程过去的许可状态。根目录 Apache-2.0 不覆盖来源工程的未来版本或其他文件。


## node-pty 1.1.0 — original license

Copyright (c) 2012-2015, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.



The MIT License (MIT)

Copyright (c) 2016, Daniel Imms (http://www.growingwiththeweb.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.



MIT License

Copyright (c) 2018 - present Microsoft Corporation

All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## @xterm/xterm 6.0.0 — original license

Copyright (c) 2017-2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
Copyright (c) 2014-2016, SourceLair Private Company (https://www.sourcelair.com)
Copyright (c) 2012-2013, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.


## @xterm/addon-fit 0.11.0 — original license

Copyright (c) 2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.


## 终端组件许可原文

### @xterm/xterm

```text
Copyright (c) 2017-2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)
Copyright (c) 2014-2016, SourceLair Private Company (https://www.sourcelair.com)
Copyright (c) 2012-2013, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### @xterm/addon-fit

```text
Copyright (c) 2019, The xterm.js authors (https://github.com/xtermjs/xterm.js)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### node-pty

```text
Copyright (c) 2012-2015, Christopher Jeffrey (https://github.com/chjj/)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.



The MIT License (MIT)

Copyright (c) 2016, Daniel Imms (http://www.growingwiththeweb.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.



MIT License

Copyright (c) 2018 - present Microsoft Corporation

All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
