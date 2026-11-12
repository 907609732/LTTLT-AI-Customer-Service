import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {electronExecutable} from '../shared/electron-runtime.mjs';
const data=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-pdd-native-send-'));
const env={...process.env,LINGTU_DATA_DIR:data,LINGTU_INTEGRATION_TEST:'1'};delete env.ELECTRON_RUN_AS_NODE;let app;
try{
 app=await electron.launch({executablePath:await electronExecutable(),args:['.'],env,timeout:30000});
 const result=await app.evaluate(async({BrowserWindow,app})=>{
  const req=process.mainModule.require.bind(process.mainModule),{PddWebAdapter}=req(app.getAppPath()+'/desk-v1/src/adapters/pdd-web');
  const w=new BrowserWindow({width:800,height:700,show:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}}),wc=w.webContents;
  const html=`<div id="app"></div><div class="chat-item-box active" data-random="buyer-1"></div><div class="messageList"><div id="messages"></div></div><textarea id="replyTextarea"></textarea><div class="reply-footer"><div class="send-btn">发送</div></div><script>
  window.fixture={sends:0,events:[],echo:true};document.getElementById('app').__vue__={$store:{state:{selectingChatUid:'buyer',todayChatList:[]}}};
  function send(e){fixture.events.push(e.isTrusted);if(!e.isTrusted)return;fixture.sends++;document.getElementById('replyTextarea').value='';if(fixture.echo)setTimeout(()=>{const item=document.createElement('div');item.className='chat-item merchantMessage';item.innerHTML='<p class="chat-message-content">fixture reply</p>';document.getElementById('messages').append(item)},40)}
  document.querySelector('.send-btn').onclick=send;document.getElementById('replyTextarea').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();send(e)}};
  </script>`;
  const reset=async()=>{await wc.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));const adapter=new PddWebAdapter({store:{platform:'pdd-web'},logger:{info(){},warn(){},error(){}},config:{},webContentsProvider:()=>wc});await adapter.ensure();return adapter};
  try{
   let a=await reset();await wc.executeJavaScript('window.fetch=async()=>({ok:false,status:403,text:async()=>JSON.stringify({success:false})});void 0');const failedHistory=await a.conversationHistory('buyer');await wc.executeJavaScript('window.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({result:{messages:[]}})});void 0');const emptyHistory=await a.conversationHistory('buyer');const success=await a.sendText('buyer','fixture reply');const sent=await wc.executeJavaScript('fixture');
   a=await reset();await wc.executeJavaScript("document.getElementById('replyTextarea').value='manual draft'");const busy=await a.sendText('buyer','fixture reply'),draft=await wc.executeJavaScript("document.getElementById('replyTextarea').value");
   a=await reset();await wc.executeJavaScript("const original=__pddWeb.prepareNativeTextSend;__pddWeb.prepareNativeTextSend=async(...args)=>{const result=await original(...args);document.getElementById('app').__vue__.$store.state.selectingChatUid='other';return result};void 0");const switched=await a.sendText('buyer','fixture reply'),switchedSends=await wc.executeJavaScript('fixture.sends');
   a=await reset();await wc.executeJavaScript("const original=__pddWeb.prepareNativeTextSend;__pddWeb.prepareNativeTextSend=async(...args)=>{const result=await original(...args);await new Promise(r=>setTimeout(r,10500));document.getElementById('app').__vue__.$store.state.selectingChatUid='other';document.getElementById('replyTextarea').value='different buyer draft';return result};void 0");const expired=await a.sendText('buyer','fixture reply'),expiredSends=await wc.executeJavaScript('fixture.sends');
   const timeouts=[];
   for(const phase of ['before','after']){
    a=await reset();await wc.executeJavaScript(`const original=__pddWeb.prepareNativeTextSend;__pddWeb.prepareNativeTextSend=async(...args)=>{if('${phase}'==='before')await new Promise(r=>setTimeout(r,250));const result=await original(...args);if('${phase}'==='after')await new Promise(r=>setTimeout(r,250));return result};void 0`);
    const failed=await a.sendText('buyer','fixture reply',{timeoutMs:100});await new Promise(r=>setTimeout(r,450));await wc.executeJavaScript('delete __pddWeb.prepareNativeTextSend;void 0');
    // Reinject a clean wrapper method without resetting hook state or its pending guard.
    await wc.executeJavaScript('window.__pddWeb.prepareNativeTextSend=original;void 0');
    await wc.executeJavaScript("document.getElementById('replyTextarea').value='manual recovery';document.getElementById('replyTextarea').focus();void 0");wc.focus();wc.sendInputEvent({type:'keyDown',keyCode:'Return'});wc.sendInputEvent({type:'keyUp',keyCode:'Return'});await new Promise(r=>setTimeout(r,80));const manualSends=await wc.executeJavaScript('fixture.sends');
    const recovered=await a.sendText('buyer','fixture reply');timeouts.push({failed,recovered,manualSends});
   }
   a=await reset();const parallel=await Promise.all([a.sendText('buyer','fixture reply'),a.sendText('buyer','fixture reply')]),parallelSends=await wc.executeJavaScript('fixture.sends');
   a=await reset();await wc.executeJavaScript('fixture.echo=false');const unknown=await a.sendText('buyer','fixture reply'),unknownSends=await wc.executeJavaScript('fixture.sends');
   return {failedHistory,emptyHistory,success,sent,busy,draft,switched,switchedSends,expired,expiredSends,timeouts,parallel,parallelSends,unknown,unknownSends};
  }finally{w.destroy()}
 });
 assert.equal(result.failedHistory.ok,false,'history permission errors cannot look like an empty new conversation');assert.equal(result.emptyHistory.ok,true);assert.deepEqual(result.emptyHistory.messages,[]);
 assert.equal(result.success.ok,true,'trusted-only PDD composer must actually submit');assert.equal(result.sent.sends,1);assert.deepEqual(result.sent.events,[true]);assert.equal(result.busy.ok,false);assert.equal(result.draft,'manual draft');assert.equal(result.switched.ok,false);assert.equal(result.switchedSends,0);assert.equal(result.expired.ok,false);assert.equal(result.expiredSends,0,'expired submission must never send a different buyer draft');for(const r of result.timeouts){assert.equal(r.failed.ok,false);assert.equal(r.manualSends,1,'manual Enter must recover after prepare timeout');assert.equal(r.recovered.ok,true,'late prepare must be cancelled without leaving a permanent guard');}assert.equal(result.parallel.filter(r=>r.ok).length,1);assert.equal(result.parallelSends,1);assert.equal(result.unknown.ok,false);assert.equal(result.unknown.reason,'send_unconfirmed');assert.equal(result.unknownSends,1);
 console.log('PASS: trusted Electron submit, manual draft retained, switched buyer blocked, concurrent send once, unknown result never retried');
}finally{await app?.close();fs.rmSync(data,{recursive:true,force:true})}
