import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import {electronExecutable} from '../shared/electron-runtime.mjs';
const exe=await electronExecutable();
if(!existsSync(exe))throw Error('Electron Runtime is missing');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
let app;
try{
 app=await electron.launch({executablePath:exe,cwd:process.cwd(),args:['.'],env,timeout:30000});
 const page=await app.firstWindow();
 await page.locator('[data-figma-node="8836:4283"]').waitFor({timeout:15000});
 const size=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getContentSize());
 if(size[0]!==1440||size[1]!==900)throw Error('Desktop content viewport must be 1440x900: '+JSON.stringify(size));
 const info=await page.evaluate(()=>window.lingtu?.info());
 if(!info||info.platform!=='win32')throw Error('IPC failed');
 const assets=await page.evaluate(async()=>{
  const nodes=[...document.querySelectorAll('[style]')];
  const el=nodes.find(n=>getComputedStyle(n).backgroundImage.includes('figma-assets/'));
  if(!el)return {found:false,loaded:false};
  const image=getComputedStyle(el).backgroundImage;
  const url=image.startsWith('url("')?image.slice(5,-2):image.startsWith('url(')?image.slice(4,-1).replace(/^["']|["']$/g,''):'';
  if(!url)return {found:true,loaded:false};
  const loaded=await new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img.naturalWidth>0);img.onerror=()=>resolve(false);img.src=url;});
  return {found:true,loaded};
 });
 if(!assets.found || !assets.loaded)throw Error('Bundled Figma image asset failed in Electron: '+JSON.stringify(assets));
 await page.locator('[data-figma-node="11:237"]').click();
 await page.locator('[data-figma-node="2:140"]').waitFor({timeout:15000});
 const bad=await page.evaluate(()=>[...document.querySelectorAll('[style]')].filter(el=>el.getAttribute('style')?.includes('figma.com')).length);
 if(bad)throw Error('Found remote Figma image in native renderer');
 console.log('Electron native Figma rebuild smoke PASS: UX01 -> UX04, preload IPC');
}finally{if(app)await app.close();}
