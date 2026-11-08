import {test,expect} from '@playwright/test';
for(const [label,id] of [['一键上线','8842:6920'],['一键小休','8842:6934'],['一键离线','8842:6948'],['一键开启AI','8842:6962'],['一键关闭AI','8842:6976'],['一键加载店铺','8842:6990'],['定时任务','8842:7140']]){
 test('native overlay '+label,async({page})=>{
  await page.setViewportSize({width:1440,height:900});await page.goto('/');await page.getByRole('button',{name:'切换一键操作菜单',exact:true}).click();await page.getByRole('button',{name:'一键操作 · '+label,exact:true}).click();await expect(page.locator('[data-figma-node="'+id+'"]').first()).toBeVisible();await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'test-results/overlays/'+id.replace(':','-')+'.png'});
 });
}
for(const warm of [false,true])for(const enabled of [false,true])for(const saved of [false,true]){
 const id=warm?(enabled?(saved?'8851:7326':'8851:7344'):(saved?'8851:7290':'8851:7308')):(enabled?(saved?'8851:7254':'8851:7272'):(saved?'8851:7218':'8851:7236'));
 test('welcome preview '+id,async({page})=>{
  await page.setViewportSize({width:1440,height:900});await page.goto('/?screen=UX11');const input=page.getByRole('textbox',{name:'欢迎语',exact:true});await expect(input).toBeVisible();
  if(warm)await page.getByRole('button',{name:'热情问候',exact:true}).click();if(enabled)await page.getByRole('button',{name:'欢迎开关 / 热区',exact:true}).click();
  if(saved)await page.getByRole('button',{name:'保存设置',exact:true}).click();else if(!warm&&!enabled)await input.fill((await input.inputValue())+' ');
  await page.getByRole('button',{name:'预览效果',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('当前'+(enabled?'开启':'关闭')+' · '+(saved?'已保存':'有待保存的更改'));await expect(page.locator('[data-figma-node="'+id+'"]').first()).toBeVisible();await expect(page.locator('.dev-toast')).toHaveCount(0);await page.screenshot({path:'test-results/overlays/'+id.replace(':','-')+'.png'});
 });
}
test('transfer save feedback matches its Figma overlay',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await page.goto('/?screen=UX08');await page.getByRole('button',{name:'保存设置',exact:true}).click();await expect(page.locator('[data-figma-node="8851:9545"]').first()).toBeVisible();await expect(page.locator('.dev-toast')).toHaveCount(0);await page.screenshot({path:'test-results/overlays/8851-9545.png'});
});

