import {test,expect} from '@playwright/test';
for(const mode of ['local','managed'] as const)test(`fallback settings are ${mode==='local'?'editable':'disabled'} in ${mode} mode`,async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.addInitScript(({mode})=>{
  const stored=()=>JSON.parse(localStorage.getItem('fallback-fixture')||'{"enabled":true,"seconds":15,"text":"稍等一下"}');
  const snap=()=>{const s=stored();return{revision:1,stores:[],selection:{storeId:'',conversationId:''},conversations:[],config:{ai:{systemPrompt:'',baseUrl:'',model:''},reply:{enabled:false,fallbackAfterMs:s.enabled?s.seconds*1000:0,fallbackText:s.text},safety:{handoffKeywords:[]}},engine:{},capabilities:{platforms:[],apiKeyConfigured:false,modelMode:mode}}};
  (window as any).lingtu={role:'main',backendSnapshot:async()=>snap(),onBackendEvent:()=>()=>{},onNavigate:()=>()=>{},onConfirmClose:()=>()=>{},backendExecute:async(c:any)=>{if(c.action==='save-automation-fallback')localStorage.setItem('fallback-fixture',JSON.stringify(c.values));return{status:'ok',message:'设置已保存'}}};
 },{mode});
 await page.goto('/?screen=UX12');const enabled=page.getByRole('checkbox',{name:'开启超时兜底'});
 if(mode==='managed'){await expect(enabled).toBeDisabled();await expect(page.getByText('托管模型模式不支持超时兜底',{exact:false})).toBeVisible();return;}
 await expect(enabled).toBeChecked();await page.getByLabel('等待秒数').fill('30');await page.getByLabel('兜底话术').fill('亲，请稍等');await page.getByRole('button',{name:'保存兜底设置'}).click();
 await expect(page.getByRole('status')).toContainText('设置已保存');await page.reload();await expect(page.getByLabel('等待秒数')).toHaveValue('30');await expect(page.getByLabel('兜底话术')).toHaveValue('亲，请稍等');
 await enabled.uncheck();await page.getByRole('button',{name:'保存兜底设置'}).click();await page.reload();await expect(enabled).not.toBeChecked();
});
