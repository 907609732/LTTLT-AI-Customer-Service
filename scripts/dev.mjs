import {createServer} from 'vite';
import {spawn} from 'node:child_process';
import electron from 'electron';
const server=await createServer();
try{await server.listen();}catch(error){console.error(error);process.exit(1);}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,['.','--dev'],{stdio:'inherit',env});
child.on('error',async(error)=>{console.error(error);await server.close();process.exit(1);});
child.on('exit',async(code)=>{await server.close();process.exit(code??0);});
process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());
