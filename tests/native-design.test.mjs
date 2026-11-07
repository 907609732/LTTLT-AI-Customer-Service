import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const base=new URL('../src/design/generated/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',base)));
const components=JSON.parse(readFileSync(new URL('components.json',base)));
test('all 32 editable Figma UX sources exist and have non-empty trees',()=>{
 assert.equal(manifest.files.length,32);
 for(const entry of manifest.files){
  const f=new URL('screens/'+entry.uxId+'.json',base);
  assert.equal(existsSync(f),true,entry.uxId);
  const design=JSON.parse(readFileSync(f,'utf8'));
  assert.equal(design.id,entry.nodeId);
  assert.ok(design.children.length>0,entry.uxId);
 }
});

test('current desktop and auxiliary sources follow the approved viewport specification',()=>{
 assert.equal(manifest.fileKey,'CR9QYrjZfTfMf6CIBj5yrb');
 for(const entry of manifest.files){
  const auxiliary=Number(entry.uxId.slice(2))>=26;
  assert.deepEqual([entry.width,entry.height],[auxiliary?300:1440,900],entry.uxId);
 }
 assert.equal(manifest.files.find(x=>x.uxId==='UX01').nodeId,'8836:4283');
 assert.equal(manifest.files.find(x=>x.uxId==='UX03').nodeId,'8836:4284');
});
test('shared Figma component definitions and their actual child layers remain available',()=>{
 assert.ok(Object.keys(components).length>=116);
 assert.ok(['SYMBOL','COMPONENT'].includes(components['8801:339'].type));
 assert.ok(components['8801:418'].children.length>0);
});
test('legacy reference screenshot is no longer a frontend dependency',()=>{
 assert.equal(existsSync(new URL('../public/assets/',import.meta.url)),false);
 assert.equal(existsSync(new URL('../src/pages/Home.tsx',import.meta.url)),false);
});

test('every exported navigation, component and overlay target has a runtime definition',()=>{
 const roots=new Set(manifest.files.map(s=>s.nodeId));const missing=new Set();
 function walk(n){for(const r of n.props.interactions||[])for(const a of r.actions||[]){
  if(a.type!=='NODE'||!a.destinationId)continue;
  if(a.navigation==='NAVIGATE'?!roots.has(a.destinationId):!components[a.destinationId])missing.add(a.navigation+':'+a.destinationId);
 }for(const c of n.children)walk(c);}
 for(const n of Object.values(components))walk(n);
 for(const s of manifest.files)walk(JSON.parse(readFileSync(new URL('screens/'+s.uxId+'.json',base),'utf8')));
 assert.deepEqual([...missing],[]);
});
