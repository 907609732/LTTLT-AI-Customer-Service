import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

/** Keep the verified npm runtime in a shared per-user ASCII path on Windows. */
export async function electronExecutable(){
 const executable=require('electron');
 if(process.platform!=='win32'||!/[\u0080-\uffff]/.test(executable))return executable;
 const {version}=require('electron/package.json');
 const base=process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local');
 if(/[\u0080-\uffff]/.test(base))throw Error('Electron运行时需要纯英文路径，请设置纯英文LOCALAPPDATA开发环境。');
 const source=path.dirname(executable),destination=path.join(base,'electron','Runtime',version);
 const candidate=path.join(destination,'electron.exe');
 let valid=false;
 try{valid=(await fs.readFile(path.join(destination,'version'),'utf8')).trim()===version&&(await fs.stat(candidate)).size>0;}catch{}
 if(!valid){await fs.mkdir(destination,{recursive:true});await fs.cp(source,destination,{recursive:true});}
 return candidate;
}
