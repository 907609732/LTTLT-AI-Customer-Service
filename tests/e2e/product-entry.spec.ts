import {test,expect} from '@playwright/test';

test('product opens without the design browser and follows native navigation',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await page.goto('/');
 await expect(page.getByRole('complementary',{name:'设计画板索引'})).toHaveCount(0);
 await expect(page.locator('[data-figma-node="8836:4283"]')).toBeVisible();
 await page.screenshot({path:'test-results/product-home-1440.png'});
 await page.locator('[data-figma-node="11:237"]').click();
 await expect(page.locator('[data-figma-node="2:140"]')).toBeVisible();
});

test('native reception menu changes mode and closes on selection',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'切换接待模式菜单',exact:true}).click();
 await page.getByRole('button',{name:/选择.*半辅助接待/}).click();
 await expect(page.getByRole('button',{name:/选择.*半辅助接待/})).toHaveCount(0);
 await expect(page.getByText('半辅助接待',{exact:true})).toBeVisible();
});

test('reception configuration is shared between online and offline home views',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'切换接待模式菜单',exact:true}).click();
 await page.getByRole('button',{name:/选择.*半辅助接待/}).click();
 await page.getByRole('button',{name:'未登录',exact:true}).click();
 await expect(page.getByText('半辅助接待',{exact:true})).toBeVisible();
});

test('long-page continuation fragments do not duplicate hidden window controls',async({page})=>{
 await page.goto('/?screen=UX04');
 await expect(page.getByRole('button',{name:'返回店铺首页',exact:true})).toHaveCount(1);
});

test('dashboard continuation reaches the bottom auxiliary shortcut',async({page})=>{
 await page.goto('/?screen=UX04');
 const scroll=page.locator('[data-figma-node="8801:448"]');
 await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight});
 await page.locator('[data-figma-node="I8839:5116;8801:793"]').click();
 await expect(page.locator('[data-figma-node="2:177"]')).toBeVisible();
});

test('transfer continuation exposes the third fallback and working fallback switch',async({page})=>{
 await page.goto('/?screen=UX08');
 const scroll=page.locator('[data-figma-node="8801:839"]');await scroll.waitFor();
 await scroll.evaluate(el=>{el.scrollTop=el.scrollHeight});
 await expect(page.getByText('话术3',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'切换无人在线兜底',exact:true}).click();
 await expect(page.getByText(/开启无人在线兜底话术.*已关闭/)).toBeVisible();
});

test('automatic operation tail scrolls while window title stays fixed',async({page})=>{
 await page.goto('/?screen=UX12');const title=page.locator('.native-titlebar').last();await title.waitFor();
 const before=await title.boundingBox();
 await page.locator('[data-figma-node="8801:1261"]').evaluate(el=>{el.scrollTop=el.scrollHeight});
 await expect(page.getByText('小额打款',{exact:true})).toBeVisible();
 expect((await title.boundingBox())?.y).toBe(before?.y);
});

test('auxiliary close cancellation preserves the actual conversation and reply draft',async({page})=>{
 await page.setViewportSize({width:300,height:900});await page.goto('/?screen=UX30');
 await page.getByRole('textbox',{name:'回复内容',exact:true}).fill('我先帮您核对一下。');
 await page.getByRole('button',{name:'关闭',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'关闭 AI 辅助中心',exact:true})).toBeVisible();
 await expect(page.getByRole('textbox',{name:'回复内容',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'回复内容',exact:true})).toHaveValue('我先帮您核对一下。');
});
