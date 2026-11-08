import {test,expect} from '@playwright/test';
for(const screen of ['UX04','UX07','UX08','UX17','UX24'])test(`${screen} titlebar X is excluded from native dragging and returns home`,async({page})=>{
 await page.goto('/?screen='+screen);const close=page.getByRole('button',{name:'返回店铺首页',exact:true}).last();await expect(close).toBeVisible();
 await expect(close).toHaveCSS('-webkit-app-region','no-drag');await close.click();await expect(page.locator('[data-figma-node="8836:4283"]')).toBeVisible();
});
test('closing configuration preserves its draft when reopened',async({page})=>{
 await page.goto('/?screen=UX17');await page.getByRole('textbox',{name:'模型规则',exact:true}).fill('关闭返回后保留输入');
 await page.getByRole('button',{name:'返回店铺首页',exact:true}).last().click();await page.locator('[data-figma-node="11:237"]').click();await page.getByText('模型定制',{exact:true}).click();await expect(page.getByRole('textbox',{name:'模型规则',exact:true})).toHaveValue('关闭返回后保留输入');
});
