import {execFileSync} from 'node:child_process';
import {readFile, writeFile, mkdir, cp} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=path.join(root,'managed-server');
const lock=JSON.parse(await readFile(path.join(folder,'upstream.lock.json'),'utf8'));
const target=path.join(folder,'.upstream');
function git(args,cwd=root){return execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','inherit']}).trim();}
if(!existsSync(path.join(target,'.git'))){
 await mkdir(folder,{recursive:true});
 const args=['clone','--depth','1','--branch',lock.tag];
 if(process.env.LINGTU_UPSTREAM_REFERENCE)args.push('--reference-if-able',process.env.LINGTU_UPSTREAM_REFERENCE);
 git([...args,lock.repository,target]);
}
if(git(['rev-parse','HEAD'],target)!==lock.commit)throw Error('New API source commit does not match upstream.lock.json');
await cp(path.join(folder,'overlay'),target,{recursive:true});
// Reapply patches from the pinned git object, never from a previously patched file.
// Exact single anchors make upstream changes fail closed rather than silently drift.
const patches=JSON.parse(await readFile(path.join(folder,'patches.json'),'utf8'));
for(const [name,edits] of Object.entries(patches)){
 let source=git(['show',`${lock.commit}:${name}`],target)+'\n';
 for(const {before,after,count=1} of edits){
  if(source.split(before).length!==count+1)throw Error(`Managed server patch anchor mismatch: ${name}`);
  source=source.split(before).join(after);
 }
 await writeFile(path.join(target,name),source);
}
const translations=JSON.parse(await readFile(path.join(folder,'translations.json'),'utf8'));
for(const language of ['en','zh','zh-TW','fr','ru','ja','vi']){
 const name=`web/src/i18n/locales/${language}.json`;
 const catalog=JSON.parse(git(['show',`${lock.commit}:${name}`],target));
 for(const [key,zh] of Object.entries(translations))if(!Object.hasOwn(catalog,key))catalog[key]=language==='zh'?zh:key;
 await writeFile(path.join(target,name),JSON.stringify(catalog,null,2)+'\n');
}
execFileSync('gofmt',['-w',...Object.keys(patches).filter(name=>name.endsWith('.go')).map(name=>path.join(target,name))],{stdio:'inherit'});
console.log(`Managed server prepared: ${target} @ ${lock.commit}`);
