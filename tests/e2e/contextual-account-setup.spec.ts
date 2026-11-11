import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{
 await page.addInitScript(()=>{
  let managed=(value:any)=>{},backend=(value:any)=>{};
  let state:any={
   session:{status:'signed_in',account:{userId:'alice',displayName:'测试账号',trial:{limit:100,remaining:100,used:0,reserved:0,expiresAt:4102444800}},expiresAt:4102444800,login:null,message:null},
   workspace:{id:null,workspaceId:'pending',mode:'locked',legacyAdoption:{count:2,claimed:false,pending:true},externalClient:{status:'unclaimed',allowed:false,canClaim:true,source:null}},message:null,
  };
  (window as any).actions=[];
  (window as any).presentations=[];
  let update=(value:any)=>{};
  (window as any).showUpdate=()=>update({status:'available',currentVersion:'0.5.2',availableVersion:'9.9.9',manual:false,checkedAt:null,message:'更新测试',revision:1});
  (window as any).signOutFixture=()=>{
   state={...state,session:{...state.session,status:'signed_out',account:null},workspace:{...state.workspace,mode:'locked',legacyAdoption:null}};
   backend({type:'workspace:reset',workspaceId:state.workspace.workspaceId});managed(state);
  };
  (window as any).readyWorkspace=()=>{
   state={...state,workspace:{...state.workspace,id:'alice',workspaceId:'ready',mode:'managed',legacyAdoption:{count:2,claimed:false,pending:false}}};
   backend({type:'workspace:reset',workspaceId:'ready'});managed(state);backend({type:'backend:changed',workspaceId:'ready',revision:1});
  };
  (window as any).lingtu={
   presentStore:async(value:any)=>{(window as any).presentations.push(value);},
   onUpdateState:(fn:any)=>{update=fn;return()=>{};},
   role:'main',onNavigate:()=>()=>{},onConfirmClose:()=>()=>{},onBackendEvent:(fn:any)=>{backend=fn;return()=>{};},
   managedSnapshot:async()=>state,onManagedState:(fn:any)=>{managed=fn;return()=>{};},
   managedAction:async(action:string,workspaceId:string)=>{
    if(workspaceId!==state.workspace.workspaceId)throw Error('stale workspace');
    (window as any).actions.push(action);
    if(action==='skip'||action==='adopt')(window as any).readyWorkspace();
    if(action==='claim-native'){
     state={...state,workspace:{...state.workspace,workspaceId:'bound',externalClient:{status:'owned',allowed:true,canClaim:false,source:'explicit'}}};
     backend({type:'workspace:reset',workspaceId:'bound'});
    }
    if(action==='local'||action==='managed'){
     state={...state,workspace:{...state.workspace,workspaceId:action,mode:action}};
     backend({type:'workspace:reset',workspaceId:action});
    }
    managed(state);return state;
   },
   backendSnapshot:async()=>({workspaceId:state.workspace.workspaceId,workspaceMode:state.workspace.mode,revision:1,stores:[],config:{ai:{systemPrompt:'',baseUrl:'',model:''},safety:{handoffKeywords:[]}},engine:{},conversations:[],selection:{storeId:'',conversationId:''},capabilities:{platforms:state.workspace.mode==='locked'?[]:[{id:'pdd-web'},{id:'doudian-client'}],apiKeyConfigured:false}}),
   backendExecute:async(command:any)=>{(window as any).actions.push(command.action);return {status:'ok'};},
  };
 });
});

test('legacy choice appears on first store use and never inside account dialog',async({page})=>{
 await page.goto('/');
 await expect(page.getByRole('region',{name:'首次使用店铺'})).toBeVisible();
 await page.getByRole('button',{name:'账号管理'}).click();
 const dialog=page.getByRole('dialog',{name:'灵兔账号'});
 await expect(dialog.getByRole('button',{name:'服务端管理后台'})).toBeVisible();
 await expect(dialog.getByText('发现已有本机店铺')).toHaveCount(0);
 await expect(dialog.getByText('本机抖店客户端')).toHaveCount(0);
 await expect(dialog.getByText('高级设置',{exact:true})).toHaveCount(0);
 await dialog.screenshot({path:'test-results/account-simplified.png'});
 await dialog.getByRole('button',{name:'关闭账号窗口'}).click();
 await page.getByRole('button',{name:'使用空白工作区',exact:true}).click();
 await expect(page.getByRole('region',{name:'首次使用店铺'})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).actions)).toEqual(['skip']);
});

test('adding doudian requires explicit contextual binding before entering a store name',async({page})=>{
 await page.goto('/?screen=UX03');
 await page.getByRole('button',{name:'使用空白工作区',exact:true}).click();
 const card=page.getByRole('button',{name:/抖店店铺 · 客户端/});
 await card.click();
 await page.getByRole('button',{name:'确认添加',exact:true}).click();
 await expect(page.getByRole('region',{name:'本机抖店客户端绑定'})).toBeVisible();
 await expect(page.getByLabel('店铺名称',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'确认绑定本机抖店客户端',exact:true}).click();
 await card.click();
 await page.getByRole('button',{name:'确认添加',exact:true}).click();
 await expect(page.getByLabel('店铺名称',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>(window as any).actions)).toEqual(['skip','claim-native']);
});

test('own key configuration and returning to managed mode live in model settings',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'使用空白工作区',exact:true}).click();
 await page.getByRole('button',{name:'模型设置⌄',exact:true}).click();
 await page.getByRole('button',{name:'使用自己的 Key',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'模型接口设置'})).toBeVisible();
 await expect(page.getByLabel('模型API Key')).toHaveValue('');
 await page.getByRole('button',{name:'切回托管模型',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'模型接口设置'})).toHaveCount(0);
 expect(await page.evaluate(()=>(window as any).actions)).toEqual(['skip','local','managed']);
});

test('signed-out store picker explains login instead of marking supported platforms unavailable',async({page})=>{
 await page.goto('/?screen=UX03');
 await page.evaluate(()=>(window as any).signOutFixture());
 await expect(page.getByRole('region',{name:'店铺服务连接'})).toBeVisible();
 await expect(page.getByRole('heading',{name:'请先登录灵兔账号'})).toBeVisible();
 await expect(page.getByRole('button',{name:'前往登录',exact:true})).toBeVisible();
 await expect(page.getByText('暂没开通',{exact:true})).toHaveCount(0);
});

test('platform list scrolls with the wheel while confirmation stays visible',async({page})=>{
 await page.setViewportSize({width:1440,height:720});
 await page.goto('/?screen=UX03');
 await page.getByRole('button',{name:'使用空白工作区',exact:true}).click();
 const list=page.getByRole('region',{name:'可滚动平台列表'});
 const confirm=page.getByRole('button',{name:'确认添加',exact:true});
 await expect(list).toBeVisible();
 await expect(confirm).toBeVisible();
 const footer=await confirm.boundingBox();
 expect(await list.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);
 await list.hover();await page.mouse.wheel(0,600);
 await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
 await expect(list.locator('.platform-source-card').last()).toBeInViewport();
 await expect(confirm).toBeInViewport();
 expect((await confirm.boundingBox())!.y).toBe(footer!.y);
 await page.screenshot({path:'test-results/platform-picker-scroll.png'});
});

test('embedded store hides for account and update dialogs and returns after closing',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'使用空白工作区',exact:true}).click();
 const visible=()=>page.evaluate(()=>(window as any).presentations.at(-1)?.visible);
 await expect.poll(visible).toBe(true);
 await page.getByRole('button',{name:'账号管理'}).click();
 await expect.poll(visible).toBe(false);
 await page.getByRole('button',{name:'关闭账号窗口'}).click();
 await expect.poll(visible).toBe(true);
 await page.evaluate(()=>(window as any).showUpdate());
 await expect(page.getByRole('dialog',{name:'软件更新'})).toBeVisible();
 await expect.poll(visible).toBe(false);
 await page.getByRole('dialog',{name:'软件更新'}).getByRole('button',{name:'关闭',exact:true}).click();
 await expect.poll(visible).toBe(true);
});
