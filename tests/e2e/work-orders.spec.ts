import {test,expect} from '@playwright/test';

test('local work orders can be registered and followed up',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.addInitScript(()=>{
  const orders=()=>JSON.parse(localStorage.getItem('workorders-fixture')||'[]');
  const snap=()=>({revision:1,stores:[{id:'s1',storeName:'测试店',platform:'pdd-web',runtime:{}}],selection:{storeId:'s1',conversationId:''},conversations:[],config:{ai:{systemPrompt:'',baseUrl:'',model:''},safety:{handoffKeywords:[]}},workOrders:orders(),engine:{},capabilities:{platforms:[],apiKeyConfigured:false}});
  (window as any).lingtu={role:'main',backendSnapshot:async()=>snap(),onBackendEvent:()=>()=>{},onNavigate:()=>()=>{},onConfirmClose:()=>()=>{},backendExecute:async(c:any)=>{let list=orders();if(c.action==='create-work-order'){const item={...c.values,id:'fixture-id',storeName:'测试店',status:'pending',createdAt:1,updatedAt:1,notes:[]};list.push(item);localStorage.setItem('workorders-fixture',JSON.stringify(list));return {status:'ok',data:{id:item.id}}}if(c.action==='set-work-order-status')list[0].status=c.values.status;if(c.action==='add-work-order-note')list[0].notes.push({id:'note',text:c.values.text,at:2});localStorage.setItem('workorders-fixture',JSON.stringify(list));return{status:'ok'}}};
 });
 await page.goto('/?screen=UX20');
 await expect(page.getByText('本机工单',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'登记工单'}).click();
 await page.getByLabel('订单号').fill('TEST-001');
 await page.getByLabel('买家昵称').fill('小王');
 await page.getByLabel('登记内容').fill('核对退款');
 await page.getByRole('button',{name:'保存登记'}).click();
 await expect(page.getByText('TEST-001',{exact:false}).first()).toBeVisible();
 await page.getByLabel('工单状态',{exact:true}).selectOption('working');
 await page.getByLabel('跟进记录').fill('已联系仓库');
 await page.getByRole('button',{name:'保存跟进'}).click();
 await expect(page.getByText('已联系仓库')).toBeVisible();
 await page.reload();
 await page.getByRole('button',{name:/TEST-001/}).click();
 await expect(page.getByLabel('工单状态',{exact:true})).toHaveValue('working');
 await expect(page.getByText('已联系仓库')).toBeVisible();
 await page.screenshot({path:'test-results/work-orders.png'});
});
