import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const exe = resolve('node_modules/electron/dist/electron.exe');
if(!existsSync(exe)) throw new Error('Electron Runtime 未安装，运行 node node_modules/electron/install.js');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await electron.launch({executablePath:exe,cwd:process.cwd(),args:['.'],env,timeout:30000});
 const page=await app.firstWindow();
 await page.getByRole('heading',{name:'选择店铺，开始 AI 接待'}).waitFor({timeout:15000});
 await page.screenshot({path:'docs/preview-home.png'});
 const info=await page.evaluate(()=>window.lingtu?.info());
 if(!info || info.mode!=='local-preview' || info.platform!=='win32') throw new Error('Electron preload IPC 未正常响应');
 const latest=await page.evaluate(()=>window.lingtu?.latestDesignSnapshot());
 if(!latest || !Object.hasOwn(latest,'snapshot')) throw new Error('本地设计快照持久化 IPC 未正常响应');
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'配置中心'}).click();
 await page.getByRole('heading',{name:'数据看板',exact:true}).waitFor();
 const broken=await page.locator('img').evaluateAll(list=>list.filter(img=>img.complete && img.naturalWidth===0).map(img=>img.src));
 if(broken.length)throw new Error('图片加载失败: '+broken.join(', '));
 console.log('Electron smoke PASS:',info.version,info.platform,'首页/导航/IPC/图标');
} finally{if(app)await app.close();}
