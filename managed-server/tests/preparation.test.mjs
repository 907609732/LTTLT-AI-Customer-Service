import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
const root=resolve(import.meta.dirname,'..');
const upstream=resolve(root,'.upstream');
const lock=JSON.parse(readFileSync(resolve(root,'upstream.lock.json'),'utf8'));
const additions=JSON.parse(readFileSync(resolve(root,'translations.json'),'utf8'));
test('generated locale overlays use the native namespace and preserve existing translations',()=>{
 for(const language of ['en','zh','zh-TW','fr','ru','ja','vi']){
  const file=`web/src/i18n/locales/${language}.json`;
  const original=JSON.parse(execFileSync('git',['show',`${lock.commit}:${file}`],{cwd:upstream,encoding:'utf8'}));
  const generated=JSON.parse(readFileSync(resolve(upstream,file),'utf8'));
  for(const [key,value] of Object.entries(original.translation))assert.deepEqual(generated.translation[key],value,`native translation changed: ${language}/${key}`);
  for(const [key,value] of Object.entries(additions)){
   if(!Object.hasOwn(original.translation,key))assert.equal(generated.translation[key],language==='zh'?value:key,`missing runtime translation: ${language}/${key}`);
   assert.equal(Object.hasOwn(generated,key),Object.hasOwn(original,key),`wrong root namespace: ${language}/${key}`);
  }
 }
});
