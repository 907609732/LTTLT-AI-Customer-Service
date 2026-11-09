import {execFileSync} from 'node:child_process';
import {readFile, mkdir, cp} from 'node:fs/promises';
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
console.log(`Managed server prepared: ${target} @ ${lock.commit}`);
