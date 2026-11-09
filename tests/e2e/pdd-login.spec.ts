import {test,expect} from '@playwright/test';
test('PDD confirm directly creates login session without requesting a shop name',async({page})=>{
 await page.addInitScript(()=>{let navigate=(id:string)=>{};let stores:any[]=[];const calls:any[]=[];(window as any).calls=calls;(window as any).lingtu={role:'main',backendSnapshot:async()=>({revision:0,stores,selection:{storeId:stores[0]?.id||'',conversationId:''},conversations:[],config:{ai:{systemPrompt:''},safety:{handoffKeywords:[]}},engine:{},capabilities:{platforms:[{id:'pdd-web',label:'拼多多'}]}}),onBackendEvent:()=>()=>{},onNavigate:(fn:any)=>{navigate=fn;return()=>{}},onConfirmClose:()=>()=>{},openMain:async(id:string)=>navigate(id),backendExecute:async(c:any)=>{calls.push(c);stores=[{id:'login-store',platform:'pdd-web',storeName:'',aiEnabled:false,runtime:{open:true,online:false,authenticated:false}}];return {status:'ok',message:'请完成登录'}}};});
 await page.goto('/?screen=UX03');await page.getByRole('button',{name:'多多店铺 · 网页',exact:true}).click();await page.getByRole('button',{name:'确认添加',exact:true}).click();
 await expect(page.getByLabel('店铺名称',{exact:true})).toHaveCount(0);await expect(page.getByRole('region',{name:'添加店铺 · 平台选择'})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).calls)).toEqual([{action:'add-store',values:{platform:'pdd-web',openAfterAdd:true}}]);
 await expect(page.getByRole('combobox',{name:'当前店铺'})).toContainText('拼多多店铺 · 待登录');
});
