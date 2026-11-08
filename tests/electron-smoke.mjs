import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import {electronExecutable} from '../shared/electron-runtime.mjs';
import {createServer} from 'vite';
const exe=await electronExecutable();
if(!existsSync(exe))throw Error('Electron Runtime is missing');
const env={...process.env,LINGTU_DATA_DIR:mkdtempSync(join(tmpdir(),'lingtu-acceptance-'))};delete env.ELECTRON_RUN_AS_NODE;
let app,server;
try{
 const dev=process.env.LINGTU_ELECTRON_TEST_DEV==='1';
 if(dev){server=await createServer();await server.listen();}
 app=await electron.launch({executablePath:exe,cwd:process.cwd(),args:['.',...(dev?['--dev']:[])],env,timeout:30000});
 console.log('Electron launched');
 const page=await app.firstWindow();
 await page.locator('[data-figma-node="8836:4283"]').waitFor({timeout:15000});
 const size=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getContentSize());
 if(size[0]!==1440||size[1]!==900)throw Error('Desktop content viewport must be 1440x900: '+JSON.stringify(size));
 console.log('Main source loaded and viewport verified');
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
 console.log('Main IPC and local assets verified');
 await page.evaluate(()=>window.lingtu.windowAction('maximize'));
 await page.waitForFunction(()=>innerWidth>1440&&document.querySelector('[data-figma-node="8836:4283"]').getBoundingClientRect().width===innerWidth);
 const font=await page.locator('[data-figma-node="11:224"]').evaluate(el=>getComputedStyle(el).fontSize);
 if(font!=='30px')throw Error('Maximizing must preserve source typography');
 await page.screenshot({path:'test-results/native-maximized.png'});
 await page.evaluate(()=>window.lingtu.windowAction('maximize'));
 await page.waitForFunction(()=>innerWidth===1440&&document.querySelector('[data-figma-node="8836:4283"]').getBoundingClientRect().width===1440);
 console.log('Native maximize/restore and fixed typography verified');
 await page.locator('[data-figma-node="11:237"]').click();
 await page.locator('[data-figma-node="2:140"]').waitFor({timeout:15000});
 const bad=await page.evaluate(()=>[...document.querySelectorAll('[style]')].filter(el=>el.getAttribute('style')?.includes('figma.com')).length);
 if(bad)throw Error('Found remote Figma image in native renderer');
 await page.getByRole('button',{name:'返回店铺首页',exact:true}).last().click();
 await page.locator('[data-figma-node="8836:4283"]').waitFor();
 await page.locator('[data-figma-node="11:230"]').click();
 await page.waitForTimeout(500);
 console.log('Auxiliary requested');
 const windows=app.windows();
 if(windows.length!==2)throw Error('Auxiliary must open its own 300x900 window; windows='+windows.length);
 const aux=windows.find(w=>w!==page);
 await aux.locator('[data-figma-node="2:177"]').waitFor();
 const sizes=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.getContentSize()));
 if(!sizes.some(s=>s[0]===300&&s[1]===900))throw Error('Auxiliary content viewport is wrong: '+JSON.stringify(sizes));
 console.log('Auxiliary source loaded, closing check');
 await aux.getByRole('button',{name:'关闭',exact:true}).click();
 await aux.getByRole('button',{name:'取消',exact:true}).click();
 await aux.locator('[data-figma-node="2:177"]').waitFor();
 await aux.getByRole('button',{name:'关闭',exact:true}).click();
 await Promise.all([
  aux.waitForEvent('close',{timeout:5000}),
  aux.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click().catch(error=>{if(!aux.isClosed())throw error;})
 ]);
 await page.waitForTimeout(300);
 if(app.windows().length!==1)throw Error('Confirm close did not close only the auxiliary window');
 console.log('Electron frontend PASS: 1440x900 main, 300x900 auxiliary, UX01 -> UX04, preload IPC, cancel/confirm close');
}catch(error){console.error('Electron smoke failed:',error);throw error;}finally{if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close();}if(server)await server.close();}
