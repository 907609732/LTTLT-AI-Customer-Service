import { build } from 'esbuild'
import fs from 'node:fs'
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version

// preload 以单文件 CJS 输出，使 sandbox 开启后无需任意本地 require。
await build({
  entryPoints: {
    main: 'electron/main.ts',
    preload: 'electron/preload.ts',
    smoke: 'electron/smoke.ts',
    'lingtu-mcp': 'electron/agent/mcp-server.ts',
  },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron', 'pdfjs-dist', 'mammoth', 'read-excel-file', '@napi-rs/canvas'],
  sourcemap: true,
  define: { __APP_VERSION__: JSON.stringify(version) },
})
