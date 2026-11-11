import {test,expect} from '@playwright/test';
test('account panel keeps login and account actions without store or model setup',async({page})=>{test.setTimeout(60000);
 await page.addInitScript(()=>{
  let state:any={session:{status:'signed_out',account:null,expiresAt:null,login:null,message:null},workspace:{id:null,workspaceId:'locked',mode:'locked',legacyAdoption:null},message:null};let managed=(s:any)=>{},backend=(e:any)=>{};
  (window as any).accountActions=[];
  (window as any).lingtu={role:'main',onNavigate:()=>()=>{},onConfirmClose:()=>()=>{},onBackendEvent:(cb:any)=>{backend=cb;return()=>{};},managedSnapshot:async()=>state,onManagedState:(cb:any)=>{managed=cb;return()=>{};},managedAction:async(action:string,id:string)=>{
   if(id!==state.workspace.workspaceId)throw Error('stale');(window as any).accountActions.push(action);
   if(action==='login'){state={...state,session:{...state.session,status:'authorizing',login:{userCode:'ABCD-EFGH',expiresAt:Math.floor(Date.now()/1000)+600}}};}
   if(action==='local'){state={...state,workspace:{...state.workspace,id:'local',workspaceId:'local',mode:'local'}};backend({type:'workspace:reset',workspaceId:'local'});}
   managed(state);return state;
  },backendSnapshot:async()=>({workspaceId:state.workspace.workspaceId,workspaceMode:state.workspace.mode,revision:0,stores:[],selection:{storeId:'',conversationId:''},conversations:[],config:{ai:{systemPrompt:'',baseUrl:'',model:''},safety:{handoffKeywords:[]}},engine:{},capabilities:{platforms:[],apiKeyConfigured:false}}),backendExecute:async()=>({status:'ok'})};
 });
 await page.goto('/?screen=UX25');const panel=page.getByRole('region',{name:'登录账号',exact:true});await expect(panel).toBeVisible({timeout:30000});await expect(page.locator('[data-design-source="UX25:8801:2697"]')).toBeVisible();
 await panel.getByRole('button',{name:'登录 / 注册灵兔账号'}).click();await expect(panel.getByLabel('登录确认码 ABCD-EFGH')).toBeVisible();
 await expect(panel.getByText('高级设置',{exact:true})).toHaveCount(0);
 await expect(panel.getByRole('button',{name:'使用自己的 Key',exact:true})).toHaveCount(0);
 await expect(panel.getByRole('button',{name:'服务端管理后台',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).accountActions)).toEqual(['login']);
});
