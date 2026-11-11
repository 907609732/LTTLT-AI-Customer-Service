import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);
const make=()=>require('../electron/updates.cjs').createUpdateService;
function fake(run){const u=new EventEmitter();u.checkForUpdates=run;return u;}
test('new release is reported without automatic download/install and fixed release URL opens',async()=>{const opened=[];const u=fake(async()=>({isUpdateAvailable:true,updateInfo:{version:'0.4.1'}}));const s=make()({updater:u,currentVersion:'0.4.0',openExternal:async url=>opened.push(url)});const result=await s.check(true);assert.equal(result.status,'available');assert.equal(result.availableVersion,'0.4.1');assert.equal(u.autoDownload,false);assert.equal(u.autoInstallOnAppQuit,false);assert.equal(u.allowPrerelease,false);assert.equal(u.allowDowngrade,false);await s.openReleasePage();assert.deepEqual(opened,['https://github.com/907609732/LTTLT-AI-Customer-Service/releases']);s.dispose();});
test('same stable version is latest, never compares commit timestamps',async()=>{const s=make()({updater:fake(async()=>({isUpdateAvailable:false,updateInfo:{version:'0.4.0'}})),currentVersion:'0.4.0'});assert.equal((await s.check(true)).status,'latest');s.dispose();});
test('missing release and network failure never become latest',async()=>{for(const [code,status] of [['ERR_UPDATER_LATEST_VERSION_NOT_FOUND','error'],['ENETUNREACH','error']]){const s=make()({updater:fake(async()=>{throw Object.assign(Error('internal endpoint details'),{code})}),currentVersion:'0.4.0'});const result=await s.check(true);assert.equal(result.status,status);assert.equal(result.message.includes('internal endpoint'),false);s.dispose();}});
test('startup and manual checks share one request and manual gets its result',async()=>{let done,calls=0;const u=fake(()=>{calls++;return new Promise(r=>done=r)});const s=make()({updater:u,currentVersion:'0.4.0'});const first=s.check(false),second=s.check(true);assert.equal(first,second);await Promise.resolve();done({isUpdateAvailable:false,updateInfo:{version:'0.4.0'}});const result=await second;assert.equal(calls,1);assert.equal(result.manual,true);s.dispose();});
test('hung provider times out and a later result cannot overwrite the failure',async()=>{let done;const s=make()({updater:fake(()=>new Promise(r=>done=r)),currentVersion:'0.4.0',timeoutMs:10});assert.equal((await s.check(true)).status,'error');done({isUpdateAvailable:false,updateInfo:{version:'0.4.0'}});await new Promise(r=>setTimeout(r,5));assert.equal(s.snapshot().status,'error');s.dispose();});

test('explicit update downloads once, reports progress, then silently installs and restarts',async()=>{
 let finish,calls=0;const installed=[];
 const u=fake(async()=>({isUpdateAvailable:true,updateInfo:{version:'0.4.3'}}));
 u.downloadUpdate=()=>{calls++;return new Promise(r=>finish=r)};u.quitAndInstall=(...args)=>installed.push(args);
 const s=make()({updater:u,currentVersion:'0.4.2'});await s.check(true);
 assert.equal(calls,0);const first=s.downloadAndInstall(),second=s.downloadAndInstall();assert.equal(first,second);await Promise.resolve();assert.equal(calls,1);
 u.emit('download-progress',{percent:45,transferred:45,total:100,bytesPerSecond:10});assert.equal(s.snapshot().progress.percent,45);assert.equal(s.snapshot().status,'downloading');
 await s.check(true);assert.equal(s.snapshot().status,'downloading');assert.equal(installed.length,0);
 u.emit('update-downloaded',{version:'0.4.3'});finish(['/cache/verified.exe']);await first;
 assert.equal(s.snapshot().status,'installing');assert.deepEqual(installed,[[true,true]]);await s.downloadAndInstall();assert.equal(installed.length,1);s.dispose();
});
test('failed or unconfirmed downloads never install and retry uses the same advertised update',async()=>{
 for(const fail of ['network','missing-verification','wrong-version']){
  let attempts=0,installs=0;const u=fake(async()=>({isUpdateAvailable:true,updateInfo:{version:'0.4.3'}}));
  u.quitAndInstall=()=>installs++;u.downloadUpdate=async()=>{attempts++;if(attempts===1){if(fail==='network')throw Error('secret internal URL');if(fail==='wrong-version')u.emit('update-downloaded',{version:'9.9.9'});return ['/cache/file.exe'];}u.emit('update-downloaded',{version:'0.4.3'});return ['/cache/file.exe'];};
  const s=make()({updater:u,currentVersion:'0.4.2'});await s.check(true);assert.equal((await s.downloadAndInstall()).status,'error');assert.equal(installs,0);assert.equal(s.snapshot().message.includes('secret'),false);await s.downloadAndInstall();assert.equal(installs,1);s.dispose();
 }
});
test('install errors can retry the verified installer without downloading again',async()=>{
 let installs=0,downloads=0;const u=fake(async()=>({isUpdateAvailable:true,updateInfo:{version:'0.4.3'}}));u.downloadUpdate=async()=>{downloads++;u.emit('update-downloaded',{version:'0.4.3'});return ['/cache/file.exe'];};u.quitAndInstallCalled=false;u.quitAndInstall=()=>{if(u.quitAndInstallCalled)return;u.quitAndInstallCalled=true;if(++installs===1)u.emit('error',Error('private path'));};
 const s=make()({updater:u,currentVersion:'0.4.2'});await s.check(true);await s.downloadAndInstall();assert.equal(s.snapshot().failureStage,'install');await s.downloadAndInstall();assert.equal(s.snapshot().status,'installing');assert.equal(downloads,1);assert.equal(installs,2);s.dispose();
});
test('disabled, unchecked and disposed services never download or install',async()=>{
 let downloaded=0,installed=0,finish;const u=fake(async()=>({isUpdateAvailable:true,updateInfo:{version:'0.4.3'}}));u.downloadUpdate=()=>{downloaded++;return new Promise(r=>finish=r)};u.quitAndInstall=()=>installed++;
 const disabled=make()({updater:u,currentVersion:'0.4.2',enabled:false});await disabled.downloadAndInstall();assert.equal(downloaded,0);disabled.dispose();
 const s=make()({updater:u,currentVersion:'0.4.2'});await s.downloadAndInstall();assert.equal(downloaded,0);await s.check(true);const flight=s.downloadAndInstall();await Promise.resolve();s.dispose();u.emit('update-downloaded',{version:'0.4.3'});finish(['/cache/file.exe']);await flight;assert.equal(installed,0);
});
test('closing immediately after update click does not start a delayed download',async()=>{
 let calls=0;const u=fake(async()=>({isUpdateAvailable:true,updateInfo:{version:'0.4.3'}}));u.downloadUpdate=async()=>{calls++;return []};const s=make()({updater:u,currentVersion:'0.4.2'});await s.check(true);const request=s.downloadAndInstall();s.dispose();await request;assert.equal(calls,0);assert.equal(u.listenerCount('error'),0);
});
