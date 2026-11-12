import {test,expect} from '@playwright/test';
test('uncertain managed request stays visible on refresh and clears only after explicit review without enabling AI',async({page})=>{
 test.setTimeout(60000);await page.addInitScript(()=>{let issue:any={code:'request_uncertain',kind:'service',message:'请求结果尚未确认，请勿自动重试。',requiresReview:true,at:1};(window as any).issueActions=[];(window as any).lingtu={role:'main',onNavigate:()=>()=>{},onConfirmClose:()=>()=>{},onBackendEvent:()=>()=>{},backendSnapshot:async()=>({workspaceId:'fixture',workspaceMode:'managed',modelIssue:issue,revision:1,stores:[],selection:{storeId:'',conversationId:''},conversations:[],config:{ai:{systemPrompt:'',baseUrl:'',model:''},reply:{enabled:false},safety:{handoffKeywords:[]}},engine:{},capabilities:{platforms:[],apiKeyConfigured:false}}),backendExecute:async(c:any)=>{(window as any).issueActions.push(c);if(c.action==='acknowledge-model-issue'&&c.values.confirmed)issue=null;return {status:'ok'};}};});
 await page.goto('/?screen=UX21');const alert=page.locator('.quality-account-error');await expect(alert).toBeVisible({timeout:30000});await page.reload();await expect(alert).toBeVisible({timeout:30000});
 await alert.getByRole('button',{name:'清除已处理提示'}).click();await expect(alert).toHaveCount(0);expect(await page.evaluate(()=>(window as any).issueActions.map((a:any)=>a.action))).toEqual(['acknowledge-model-issue']);
});

test('floating issue displays original conversation details and can collapse',async({page})=>{
 await page.addInitScript(()=>{
  (window as any).issueCommands=[];(window as any).issueHeights=[];
  const issue={code:'delivery_unconfirmed',kind:'service',message:'回复发送状态未确认',requiresReview:true,at:1700000000000,context:{storeId:'store',uid:'buyer',storeName:'测试店铺',buyerName:'测试买家',buyerMessage:'买家的问题',reply:'需要核对的回答'}};
  (window as any).lingtu={role:'main',resizeModelIssue:async(h:number)=>(window as any).issueHeights.push(h),onBackendEvent:()=>()=>{},backendSnapshot:async()=>({workspaceId:'fixture',modelIssue:issue,revision:1,stores:[],selection:{storeId:'',conversationId:''},conversations:[],config:{ai:{systemPrompt:''},safety:{handoffKeywords:[]}},engine:{},capabilities:{platforms:[],apiKeyConfigured:false}}),backendExecute:async(c:any)=>{(window as any).issueCommands.push(c.action);return {status:'ok'};}};
 });
 await page.goto('/?notice=model-issue');
 const alert=page.getByRole('alert',{name:'托管 AI 暂停提示'});
 await expect(alert.getByRole('region',{name:'待核对记录'})).toContainText('测试店铺');
 await expect(alert.getByRole('region',{name:'待核对记录'})).toContainText('测试买家');
 await expect(alert.getByText('买家的问题',{exact:true})).toBeVisible();
 await expect(alert.getByText('需要核对的回答',{exact:true})).toBeVisible();
 await alert.getByRole('button',{name:'定位原会话'}).click();
 expect(await page.evaluate(()=>(window as any).issueCommands)).toEqual(['review-model-issue']);
 await alert.screenshot({path:'test-results/model-issue-floating.png'});
 await alert.getByRole('button',{name:'收起',exact:true}).click();
 await expect(alert.getByText('需要核对的回答',{exact:true})).toHaveCount(0);
 await alert.getByRole('button',{name:'查看异常记录'}).click();
 await expect(alert.getByText('需要核对的回答',{exact:true})).toBeVisible();
});
