// Official presets; custom endpoints remain editable in advanced settings.
export const modelProviders = {
 deepseek:{label:'DeepSeek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',keyUrl:'https://platform.deepseek.com/api_keys'},
 qwen:{label:'通义千问 · 百炼（北京）',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus',keyUrl:'https://bailian.console.aliyun.com/?tab=model#/api-key'},
 qwenVision:{label:'通义千问 · Qwen3-VL 识图',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen3-vl-plus',keyUrl:'https://bailian.console.aliyun.com/?tab=model#/api-key'},
};
export function detectModelProvider(baseUrl='',model='') {
 try{const u=new URL(baseUrl);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)return 'custom';const p=u.pathname.replace(/\/+$/,'');if(u.hostname==='api.deepseek.com'&&['','/v1'].includes(p))return 'deepseek';if(u.hostname==='dashscope.aliyuncs.com'&&p==='/compatible-mode/v1')return model==='qwen3-vl-plus'?'qwenVision':'qwen';}catch{}
 return 'custom';
}
