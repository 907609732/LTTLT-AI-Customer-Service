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
