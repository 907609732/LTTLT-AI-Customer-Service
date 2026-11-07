import type {FrontendServices} from './contracts';
/** UI-only adapter. It never logs in to stores, sends to customers, runs orders or calls an AI model. */
export const frontendServices:FrontendServices={
 async execute(command){
  if(command.action==='save-config'||command.action==='save-tasks')return {status:'demo',data:structuredClone(command.values),message:'前端演示配置已保存；正式持久化由后端接入。'};
  return {status:'not-connected',message:'界面操作已就绪，实际业务服务尚未接入。'};
 }
};
