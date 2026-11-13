import { build } from 'esbuild'

// preload 以单文件 CJS 输出，使 sandbox 开启后无需任意本地 require。
await build({
  entryPoints: {
    main: 'electron/main.ts',
    preload: 'electron/preload.ts',
    smoke: 'electron/smoke.ts',
  },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
})
