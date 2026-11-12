import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createProductKnowledge}=require('../electron/product-knowledge.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'product-knowledge-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'products.json');return {file,service:createProductKnowledge(file)};}
const product={storeId:'a',productId:'sku1',title:'小米智能门锁',description:'支持 NFC 卡开门',specifications:'全球版',price:'67.00',enabled:true};
test('商品按店铺隔离并持久化，中文搜索只返回启用商品',t=>{const {file,service:s}=fixture(t);s.save(product);s.save({...product,storeId:'b',description:'其他店铺私有信息'});assert.equal(s.search('a','门锁 NFC').length,1);assert.equal(s.search('a','门锁')[0].description,product.description);assert.equal(createProductKnowledge(file).list('b').total,1);const row=s.list('a').items[0];s.save({...row,enabled:false});assert.equal(s.search('a','门锁').length,0);});
test('CSV 预览不写入，导入原子校验且拒绝过期版本',t=>{const {service:s}=fixture(t);const csv='productId,title,description\n1,门锁,"支持 NFC\n支持密码"';const preview=s.previewImport('a',csv);assert.equal(s.list('a').total,0);s.importCsv('a',csv,{revision:preview.revision,mode:'skip',confirmed:true});assert.equal(s.list('a').total,1);assert.throws(()=>s.importCsv('a',csv,{revision:0,mode:'replace',confirmed:true}),/更新/);assert.throws(()=>s.importCsv('a','productId,title\n2,正常\n3,',{revision:s.summary().revision,mode:'skip',confirmed:true}));assert.equal(s.list('a').total,1);});
test('修改与删除要求准确版本，损坏文件保持原样',t=>{const {file,service:s}=fixture(t);const row=s.save(product);s.save({...row,title:'新标题'});assert.throws(()=>s.save({...row,title:'旧版本覆盖'}),/更新/);assert.throws(()=>s.remove('b',row.id,2,true),/不存在/);assert.throws(()=>s.remove('a',row.id,2,false),/确认/);fs.writeFileSync(file,'broken');assert.throws(()=>createProductKnowledge(file),/损坏/);assert.equal(fs.readFileSync(file,'utf8'),'broken');});

test('商品标题只有唯一匹配才能确定身份',t=>{const {service:s}=fixture(t);s.save(product);assert.equal(s.identifyTitle('a',product.title),'sku1');s.save({...product,productId:'sku2'});assert.equal(s.identifyTitle('a',product.title),'');assert.equal(s.identifyTitle('b',product.title),'');assert.equal(s.getByProductId('a','sku1').title,product.title);});

test('商品编码、SKU与JSON导入可检索且整批原子校验',t=>{const {service:s}=fixture(t);const row=s.save({...product,code:'LOCK-G',skus:[{skuId:'sku-red',attributes:'红色 全球版',price:'67',stock:7}]});assert.equal(s.search('a','sku-red')[0].id,row.id);assert.equal(s.search('b','sku-red').length,0);assert.throws(()=>s.save({...row,skus:[{skuId:'same',attributes:'A'},{skuId:'same',attributes:'B'}]}));assert.equal(s.list('a').items[0].version,1);const json=s.exportJson('a');const preview=s.previewImport('b',json,'json');s.importJson('b',json,{revision:preview.revision,confirmed:true,mode:'skip'});assert.equal(s.list('b').items[0].skus[0].stock,7);assert.equal(s.list('b').items[0].source.kind,'json');const bad=JSON.stringify([{productId:'2',title:'有效'},{productId:'3',title:''}]);assert.throws(()=>s.previewImport('b',bad,'json'));assert.equal(s.list('b').total,1);});

test('商品管理按编码与SKU查询包含停用记录，CSV错误启用值不静默启用',t=>{
 const {service:s}=fixture(t);s.save({...product,code:'LOCK',skus:[{skuId:'red',attributes:'红色'}]});s.save({...product,productId:'disabled',code:'OFF',enabled:false});s.save({...product,storeId:'b',code:'LOCK'});
 assert.equal(s.list('a',{query:'OFF'}).items[0].productId,'disabled');assert.equal(s.list('a',{query:'red'}).total,1);assert.equal(s.list('a',{query:'不存在'}).total,0);assert.equal(s.search('a','OFF').length,0);
 assert.throws(()=>s.previewImport('a','productId,title,enabled\nbad,错误,flase'),/enabled|启用/);assert.equal(s.list('a').total,2);
});

test('SKU参考仅发送相关有界数据，保留末尾准确规格且不外发顾客来源',t=>{
 const {service:s}=fixture(t);const skus=Array.from({length:200},(_,i)=>({skuId:'SKU-'+i,attributes:'规格'.repeat(250),price:'参考'.repeat(40),stock:i}));
 const row=s.save({...product,skus,description:'说明'.repeat(3000),specifications:'参数'.repeat(1500),source:{kind:'conversation',uid:'NEVER-SEND-CUSTOMER'}});
 const references=s.references('a','SKU-199',row.productId);assert.equal(references[0].skus[0].skuId,'SKU-199');assert.equal(references[0].skuCount,200);assert.equal(references[0].skusIncluded,8);assert.ok(JSON.stringify(references).length<16000);assert.doesNotMatch(JSON.stringify(references),/NEVER-SEND-CUSTOMER/);
});
