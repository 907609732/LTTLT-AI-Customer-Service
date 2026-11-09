import {test,expect} from '@playwright/test';

test('training uses a simulated conversation and retains input on error',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.addInitScript(()=>{
  const snap=()=>({revision:1,stores:[],selection:{storeId:'',conversationId:''},conversations:[],config:{ai:{systemPrompt:'',baseUrl:'',model:''},safety:{handoffKeywords:[]}},bannedWords:[],engine:{},capabilities:{platforms:[],apiKeyConfigured:false}});
  (window as any).trainingCalls=[];
  (window as any).lingtu={role:'main',backendSnapshot:async()=>snap(),onBackendEvent:()=>()=>{},onNavigate:()=>()=>{},onConfirmClose:()=>()=>{},backendExecute:async(c:any)=>{(window as any).trainingCalls.push(c);if(c.values.question==='出错')throw Error('模型连接失败');return {status:'ok',data:{reply:c.values.question==='有货吗'?'目前有货':'欢迎咨询'}}}};
 });
 await page.goto('/?screen=UX16');
 await expect(page.getByText('不会向买家发送消息',{exact:false})).toBeVisible();
 const input=page.getByRole('textbox',{name:'模拟买家问题'});
 await input.fill('有货吗');await page.getByRole('button',{name:'发送测试'}).click();
 await expect(page.getByText('目前有货')).toBeVisible();
 await input.fill('再看看');await input.press('Enter');
 await expect(page.getByText('欢迎咨询')).toBeVisible();
 const calls=await page.evaluate(()=>(window as any).trainingCalls);
 expect(calls[1].values.history).toEqual([{from:'buyer',content:'有货吗'},{from:'seller',content:'目前有货'}]);
 await input.fill('出错');await page.getByRole('button',{name:'发送测试'}).click();
 await expect(page.getByRole('alert')).toContainText('模型连接失败');await expect(input).toHaveValue('出错');
 await page.screenshot({path:'test-results/training.png'});
});
