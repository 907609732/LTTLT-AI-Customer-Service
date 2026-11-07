import {spawn} from 'node:child_process';
import {electronExecutable} from '../shared/electron-runtime.mjs';
const env={...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(await electronExecutable(),['.'],{stdio:'inherit',env});
child.on('error',error=>{console.error(error);process.exit(1);});
child.on('exit',code=>process.exit(code??0));
