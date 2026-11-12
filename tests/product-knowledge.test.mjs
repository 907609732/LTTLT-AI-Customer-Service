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
