import {readFileSync,writeFileSync,mkdirSync,readdirSync,copyFileSync,existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
const map=JSON.parse(readFileSync(resolve('docs/figma-map.json'),'utf8'));
const hash=map.sourceSnapshotHash;
if(!hash)throw Error('Run npm run design:decode -- your.fig first');
const dir=resolve('design/snapshots',hash);
if(!existsSync(join(dir,'inventory.json')))throw Error('Missing offline design inventory');
const out=resolve('src/design/generated');
mkdirSync(join(out,'screens'),{recursive:true});
const sourceScreens=join(dir,'screens');
const ids=map.screens.map(x=>x.uxId);
let usedHashes=new Set();
function collect(node){
 for(const p of [...(node.props?.fillPaints||[]),...(node.props?.strokePaints||[])]){
  const hashBytes=p.image?.hash;
  if(hashBytes){const vals=Array.from(Object.values(hashBytes));const hex=vals.map(x=>Number(x).toString(16).padStart(2,'0')).join('');if(/^[a-f0-9]{40}$/.test(hex))usedHashes.add(hex);}
 }
 for(const c of node.children||[])collect(c);
}
for(const id of ids){const node=JSON.parse(readFileSync(join(sourceScreens,id+'.json'),'utf8'));collect(node);writeFileSync(join(out,'screens',id+'.json'),JSON.stringify(node),'utf8');}
const defs={};
for(const file of readdirSync(join(dir,'components'))){if(!file.endsWith('.json'))continue;const node=JSON.parse(readFileSync(join(dir,'components',file),'utf8'));defs[node.id]=node;collect(node);}
writeFileSync(join(out,'components.json'),JSON.stringify(defs),'utf8');
const assetsOut=resolve('public/figma-assets');
mkdirSync(assetsOut,{recursive:true});
const available=new Map(readdirSync(join(dir,'images')).map(file=>[file.split('.')[0],file]));
let copied=0;
for(const hash of usedHashes){const file=available.get(hash);if(file){copyFileSync(join(dir,'images',file),join(assetsOut,file));copied++;}}
const lookup={};
for(const hash of usedHashes){const file=available.get(hash);if(file)lookup[hash]='./figma-assets/'+file;}
writeFileSync(join(out,'assets.json'),JSON.stringify(lookup),'utf8');
writeFileSync(join(out,'manifest.json'),JSON.stringify({hash,files:ids.map(id=>({uxId:id,source:map.screens.find(s=>s.uxId===id)?.sourceName,nodeId:map.screens.find(s=>s.uxId===id)?.figmaNodeId,width:map.screens.find(s=>s.uxId===id)?.sourceSize?.[0],height:map.screens.find(s=>s.uxId===id)?.sourceSize?.[1]}))}),'utf8');
console.log('PREPARED '+ids.length+' editable screen trees, '+Object.keys(defs).length+' shared component definitions, '+copied+'/'+usedHashes.size+' referenced image assets');
console.log('Outputs: src/design/generated + public/figma-assets');
