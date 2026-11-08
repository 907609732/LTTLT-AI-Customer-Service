import {test,expect} from '@playwright/test';

test('welcome accepts real text and restore uses the saved draft',async({page})=>{
 await page.goto('/?screen=UX11');
 const field=page.getByRole('textbox',{name:'欢迎语',exact:true});
 await field.fill('您好，请告诉我需要什么规格。',{timeout:5000});
 await page.getByRole('button',{name:'保存设置',exact:true}).click();
 await expect(page.getByRole('status')).toContainText('演示');
 await field.fill('没有保存的修改');
 await page.getByRole('button',{name:'恢复已保存内容',exact:true}).click();
 await expect(field).toHaveValue('您好，请告诉我需要什么规格。');
});

test('image prompt is editable with an accessible toggle and live character count',async({page})=>{
 await page.goto('/?screen=UX14');
 await page.getByRole('textbox',{name:'识别提示词',exact:true}).fill('请检查包裹是否破损。',{timeout:5000});
 await expect(page.getByText('10/300',{exact:true})).toBeVisible();
 await page.getByRole('switch',{name:'启用图片识别提示',exact:true}).click();
 await expect(page.getByRole('switch',{name:'启用图片识别提示',exact:true})).toHaveAttribute('aria-checked','true');
});

test('banned word editor adds, searches and removes actual tags',async({page})=>{
 await page.goto('/?screen=UX19');
 await page.getByRole('textbox',{name:'禁用词',exact:true}).fill('微信=wx，最强',{timeout:5000});
 await page.getByRole('button',{name:'添加',exact:true}).click();
 await expect(page.getByRole('button',{name:'删除禁用词 微信'})).toBeVisible();
 await page.getByRole('textbox',{name:'搜索禁用词',exact:true}).fill('最强');
 await expect(page.getByRole('button',{name:'删除禁用词 微信'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'删除禁用词 最强'})).toBeVisible();
 await page.getByRole('button',{name:'删除禁用词 最强'}).click();
 await expect(page.getByRole('button',{name:'删除禁用词 最强'})).toHaveCount(0);
});

test('custom task fields survive closing and reopening and deletion requires confirmation',async({page})=>{
 await page.goto('/');
 const open=async()=>{const task=page.getByRole('button',{name:'一键操作 · 定时任务',exact:true});if(!await task.isVisible())await page.getByRole('button',{name:'切换一键操作菜单',exact:true}).click();await task.click();};
 await open();await page.getByRole('button',{name:'新建任务',exact:true}).click();
 await page.getByRole('button',{name:'保存任务',exact:true}).click();
 await expect(page.getByRole('alert')).toContainText('请填写任务名称');
 await page.getByRole('textbox',{name:'任务名称',exact:true}).fill('晚班离线任务');
 await page.getByLabel('操作类型',{exact:true}).selectOption('一键离线');
 await page.getByRole('button',{name:'保存任务',exact:true}).click();
 await expect(page.getByText('晚班离线任务',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'关闭定时任务',exact:true}).click();
 await open();
 await expect(page.getByText('晚班离线任务',{exact:true})).toBeVisible();
 await expect(page.getByText(/每天 09:00 · 一键离线/)).toBeVisible();
 await page.getByRole('button',{name:'删除',exact:true}).click();
 await page.getByRole('button',{name:'取消',exact:true}).click();
 await expect(page.getByText('晚班离线任务',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'删除',exact:true}).click();
 await page.getByRole('button',{name:'确认删除',exact:true}).click();
 await expect(page.getByText('晚班离线任务',{exact:true})).toHaveCount(0);
});

test('empty conversation cannot send and training Enter retains text when backend is not connected',async({page})=>{
 await page.goto('/?screen=UX26');
 await expect(page.getByRole('textbox',{name:'回复内容',exact:true})).toBeDisabled();
 await expect(page.getByRole('button',{name:'发送',exact:true})).toHaveAttribute('aria-disabled','true');
 await page.goto('/?screen=UX16');
 const input=page.getByRole('textbox',{name:'训练问题',exact:true});await input.fill('这个商品是什么规格？');await input.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});await expect(page.getByRole('status')).toHaveCount(0);await expect(input).toHaveValue('这个商品是什么规格？');await input.press('Enter');
 await expect(page.getByRole('status')).toContainText('尚未接入');
 await expect(input).toHaveValue('这个商品是什么规格？');
});
