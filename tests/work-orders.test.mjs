import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
const {createBackend}=createRequire(import.meta.url)('../electron/backend.cjs');

test('work orders persist, track statuses and notes, and reject unknown stores',async()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-workorders-'));let backend=createBackend({dataDir});
 await backend.execute({action:'add-store',values:{storeName:'测试店',platform:'pdd-web'}});const storeId=backend.snapshot().selection.storeId;
 const fields={storeId,type:'退款跟进',orderNo:'TEST-001',buyer:'测试买家',priority:'normal',description:'核对退款原因'};
 await assert.rejects(()=>backend.execute({action:'create-work-order',values:{...fields,storeId:'unknown'}}));
 await assert.rejects(()=>backend.execute({action:'create-work-order',values:{...fields,orderNo:'  '}}));
 const created=await backend.execute({action:'create-work-order',values:fields});const id=created.data.id;
 assert.equal(backend.snapshot().workOrders[0].status,'pending');
 await backend.execute({action:'add-work-order-note',values:{id,text:'已联系仓库'}});
 await backend.execute({action:'set-work-order-status',values:{id,status:'working'}});
 await assert.rejects(()=>backend.execute({action:'set-work-order-status',values:{id,status:'made-up'}}));
 backend.dispose();backend=createBackend({dataDir});
 let item=backend.snapshot().workOrders[0];assert.equal(item.orderNo,'TEST-001');assert.equal(item.status,'working');assert.equal(item.notes[0].text,'已联系仓库');
 await backend.execute({action:'set-work-order-status',values:{id,status:'done'}});
 item=backend.snapshot().workOrders[0];assert.equal(item.status,'done');assert.equal(item.storeName,'测试店');
 backend.dispose();
});

test('corrupt work orders are not overwritten',()=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'lingtu-workorders-corrupt-'));const file=path.join(dataDir,'work-orders.json');fs.writeFileSync(file,'bad-json');
 assert.throws(()=>createBackend({dataDir}),/工单数据损坏/);assert.equal(fs.readFileSync(file,'utf8'),'bad-json');
});
