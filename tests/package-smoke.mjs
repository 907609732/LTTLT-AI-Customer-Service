import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const file = process.env.LINGTU_PACKAGED_EXE||resolve('release/win-unpacked/LingtuCustomerService.exe');
if(!existsSync(file)) throw new Error('先运行 npm run dist:win 来构建打包程序');
const env={...process.env,LINGTU_DATA_DIR:mkdtempSync(join(tmpdir(),'lingtu-acceptance-'))};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await electron.launch({executablePath:file,args:[],env,timeout:30000});
 const page=await app.firstWindow();
 await page.locator('[data-figma-node="8836:4283"]').waitFor({timeout:20000});
 const info=await page.evaluate(()=>window.lingtu?.info());
 if(!info || info.platform!=='win32')throw new Error('安装包预览的安全 preload/IPC 调用失败');
 const assets=await page.evaluate(async()=>{
  const all=[...document.querySelectorAll('[style]')];
  const el=all.find(n=>getComputedStyle(n).backgroundImage.includes('figma-assets/'));
  if(!el)return {found:false,loaded:false};
  const css=getComputedStyle(el).backgroundImage;
  const url=css.startsWith('url("')?css.slice(5,-2):css.startsWith('url(')?css.slice(4,-1).replace(/^["']|["']$/g,''):'';
  const loaded=await new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img.naturalWidth>0);img.onerror=()=>resolve(false);img.src=url;});
  return {found:true,loaded};
 });
 if(!assets.found||!assets.loaded)throw new Error('打包文件中的 Figma 图片不可用：'+JSON.stringify(assets));
 await page.locator('[data-figma-node="11:237"]').click();
 await page.locator('[data-figma-node="2:140"]').waitFor({timeout:15000});
 console.log('Packaged Electron v'+info.version+' PASS: native UX01→UX04, preload IPC, Figma image asset');
} finally{if(app)await app.close();}
