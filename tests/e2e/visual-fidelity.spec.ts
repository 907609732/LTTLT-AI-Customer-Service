import {test,expect} from '@playwright/test';
test('Figma inside strokes do not shift nested child coordinates',async({page})=>{
 await page.goto('/?screen=UX07');const p=page.locator('[data-figma-node="8801:243"]'),c=page.locator('[data-figma-node="8801:347"]');await expect(c).toBeVisible();
 expect((await c.boundingBox())!.x-(await p.boundingBox())!.x).toBe(57);
});
test('editable fields preserve Figma search artwork and welcome template buttons',async({page})=>{
 await page.goto('/');await expect(page.locator('[data-figma-node="11:68"]')).toBeVisible();
 await page.goto('/?screen=UX11');await expect(page.getByText('22/200',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'默认问候',exact:true})).toBeVisible();await page.getByRole('button',{name:'热情问候',exact:true}).click();await expect(page.getByRole('textbox',{name:'欢迎语',exact:true})).toHaveValue(/欢迎来到本店/);
});
test('model editor preserves original multiline presentation before editing',async({page})=>{
 await page.goto('/?screen=UX17');await expect(page.locator('[data-figma-node="8801:1899"]')).toBeVisible();await page.getByRole('textbox',{name:'模型规则',exact:true}).fill('新的规则');await expect(page.getByRole('textbox',{name:'模型规则',exact:true})).toHaveValue('新的规则');
});
test('close confirmation reuses the exact editable Figma dialog',async({page})=>{
 await page.setViewportSize({width:300,height:900});await page.goto('/?screen=UX29');await page.getByRole('button',{name:'关闭',exact:true}).click();const box=page.locator('[data-figma-node="8801:3041"]');await expect(box).toBeVisible();expect((await box.boundingBox())!.width).toBe(268);expect((await box.boundingBox())!.height).toBe(158);
});

test('welcome preview derives draft status from the actual edited text',async({page})=>{
 await page.goto('/?screen=UX11');await page.getByRole('textbox',{name:'欢迎语',exact:true}).fill('新的欢迎语');await page.getByRole('button',{name:'预览效果',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('当前关闭 · 有待保存的更改');
});
test('native task layout keeps focus while typing and matches the empty Figma state',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'切换一键操作菜单',exact:true}).click();await page.getByRole('button',{name:'一键操作 · 定时任务',exact:true}).click();await expect(page.locator('[data-figma-node="8842:7004"]')).toBeVisible();await page.getByRole('button',{name:'新建任务',exact:true}).click();const field=page.getByRole('textbox',{name:'任务名称',exact:true});await field.pressSequentially('test');await expect(field).toBeFocused();await expect(field).toHaveValue('test');
});


test('single-line Figma text boxes do not gain unintended wrapping',async({page})=>{
 await page.setViewportSize({width:300,height:900});await page.goto('/?screen=UX30');const title=page.locator('[data-figma-node="8801:2943"]');await expect(title).toBeVisible();expect(await title.evaluate(e=>getComputedStyle(e).whiteSpace)).toBe('pre');
});

test('deleting the last of two tasks keeps the remaining native task card populated',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'切换一键操作菜单',exact:true}).click();await page.getByRole('button',{name:'一键操作 · 定时任务',exact:true}).click();
 for(const name of ['第一条任务','第二条任务']){await page.getByRole('button',{name:'新建任务',exact:true}).click();await page.getByRole('textbox',{name:'任务名称',exact:true}).fill(name);await page.getByRole('button',{name:'保存任务',exact:true}).click();await expect(page.getByText(name,{exact:true})).toBeVisible();}
 await page.getByRole('article').filter({hasText:'第二条任务'}).getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await expect(page.getByText('第一条任务',{exact:true})).toBeVisible();await expect(page.getByRole('dialog')).not.toContainText('undefined');
});
