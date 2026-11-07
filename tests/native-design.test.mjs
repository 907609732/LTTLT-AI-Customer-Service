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
test('116 reusable Figma symbol definitions are available as components',()=>{
 assert.equal(Object.keys(components).length,116);
 assert.equal(components['8801:339'].type,'SYMBOL');
 assert.ok(components['8801:418'].children.length>0);
});
test('legacy reference screenshot is no longer a frontend dependency',()=>{
 assert.equal(existsSync(new URL('../public/assets/',import.meta.url)),false);
 assert.equal(existsSync(new URL('../src/pages/Home.tsx',import.meta.url)),false);
});
