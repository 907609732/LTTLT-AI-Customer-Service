import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {parseSnapshot,MAX_SNAPSHOT_BYTES} from '../shared/snapshot.mjs';
try{
 if(!process.argv[2])throw new Error('用法: npm run design:import -- "设计快照.json"');
 const source=resolve(process.argv[2]);
 if((await stat(source)).size>MAX_SNAPSHOT_BYTES)throw new Error('快照不得超过 20 MB');
 const raw=await readFile(source,'utf8');const data=parseSnapshot(raw);
 const hash=createHash('sha256').update(raw).digest('hex').slice(0,12);
 const folder=resolve('design/snapshots',hash);await mkdir(folder,{recursive:true});
 await writeFile(join(folder,'snapshot.json'),JSON.stringify(data,null,2));
 const index=[];
 for(const [i,node] of data.nodes.entries()){
  const name=`${String(i+1).padStart(2,'0')}-${node.id.replace(/[^\w-]/g,'_')}`;
  await writeFile(join(folder,`${name}.json`),JSON.stringify(node.document,null,2));
  if(node.preview)await writeFile(join(folder,`${name}.png`),Buffer.from(node.preview.split(',')[1],'base64'));
  index.push({id:node.id,name:node.name,width:node.width,height:node.height,structure:`${name}.json`,preview:node.preview?`${name}.png`:null});
 }
 await writeFile(join(folder,'index.json'),JSON.stringify(index,null,2));
 console.log(`已导入 ${index.length} 个画板 → ${folder}\n本目录默认不提交 Git。快照只作开发参考，不自动生成业务代码。`);
}catch(error){console.error(error.message);process.exitCode=1;}
