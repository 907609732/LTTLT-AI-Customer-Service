import {test,expect} from '@playwright/test';
const sizes=[[1366,768],[1440,900],[1920,1080],[2560,1440]] as const;
for(const [width,height] of sizes){
 test('native UX01 layout renders at '+width+'x'+height,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setViewportSize({width,height});await page.goto('/?design=1');
  await expect(page.locator('[data-figma-node="8836:4283"]')).toBeVisible();
  await expect(page.getByText('选择店铺，开始 AI 接待',{exact:true})).toBeVisible();
  if(width===1440)await page.screenshot({path:'test-results/native-ux01-review.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  expect(errors).toEqual([]);
 });
}
test('native layer buttons navigate to the exact corresponding Figma screen',async({page})=>{
 await page.goto('/?design=1');await page.locator('[data-figma-node="11:237"]').click();
 await expect(page.locator('[data-figma-node="2:140"]')).toBeVisible();
 await page.getByRole('button',{name:'返回首页画板'}).click();
 await page.locator('[data-figma-node="11:230"]').click();
 await expect(page.locator('[data-figma-node="2:177"]')).toBeVisible();
});
test('editable screen index switches among 32 source frames',async({page})=>{
 await page.goto('/?design=1');const items=page.getByRole('navigation',{name:'可编辑画板'}).getByRole('button');
 await expect(items).toHaveCount(32);
 await page.getByRole('navigation',{name:'可编辑画板'}).getByRole('button',{name:/UX15/}).click();
 await expect(page.locator('[data-figma-node="2:165"]')).toBeVisible();
 await page.getByRole('button',{name:'下一画板'}).click();
 await expect(page.locator('[data-figma-node="2:166"]')).toBeVisible();
});
test('Figma source assets are present locally without external URLs',async({page})=>{
 const failed:string[]=[];page.on('requestfailed',req=>failed.push(req.url()));
 await page.goto('/?design=1');
 await expect(page.locator('[data-figma-node="8836:4283"]')).toBeVisible();
 const count=await page.locator('[style*="figma-assets"]').count();
 expect(count).toBeGreaterThan(0);
 expect(failed.filter(x=>x.includes('figma.com'))).toEqual([]);
});
test('design index can be collapsed and zoom mode changed',async({page})=>{
 await page.goto('/?design=1');
 await page.getByRole('button',{name:'隐藏画板索引'}).click();
 await expect(page.getByRole('button',{name:'显示画板索引'})).toBeVisible();
 await page.getByRole('button',{name:'适合窗口'}).click();
 await expect(page.getByRole('button',{name:'原始尺寸'})).toBeVisible();
});
