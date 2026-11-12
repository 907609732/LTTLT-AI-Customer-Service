import {fileURLToPath} from 'node:url';
import {openSourceConsole,shouldOpenSourceConsole} from './source-console.mjs';
import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import {electronExecutable} from '../shared/electron-runtime.mjs';
if(shouldOpenSourceConsole(process.platform,process.argv.slice(2))){
 try{await openSourceConsole({entry:fileURLToPath(import.meta.url),cwd:fileURLToPath(new URL('..',import.meta.url))});process.exit(0)}
 catch(error){console.warn('独立控制台未能打开，改用当前终端：'+error.message)}
}
const server=await createServer();
try{await server.listen();}catch(error){console.error(error);process.exit(1);}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(await electronExecutable(),['.','--dev','--source-diagnostics'],{stdio:'inherit',env});
child.on('error',async(error)=>{console.error(error);await server.close();process.exit(1);});
child.on('exit',async(code)=>{await server.close();process.exit(code??0);});
process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());
