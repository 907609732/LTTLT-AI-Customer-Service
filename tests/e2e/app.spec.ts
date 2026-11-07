import {test,expect} from '@playwright/test';
for(const [width,height] of [[1366,768],[1440,900],[1920,1080],[2560,1440]]){
 test(`home and configuration fit ${width}x${height}`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height});await page.goto('/');
  await expect(page.getByRole('heading',{name:'选择店铺，开始 AI 接待'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'配置中心'}).click();
  await expect(page.getByRole('heading',{name:'数据看板',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
 });
}
test('add demo store, persist welcome and guard dirty changes',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'添加店铺',exact:true}).first().click();await page.getByLabel('店铺名称').fill('联调演示店');await page.getByRole('button',{name:'添加到本地预览'}).click();
 await expect(page.getByRole('heading',{name:'欢迎回来，联调演示店'})).toBeVisible();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'配置中心'}).click();await page.getByRole('navigation',{name:'配置导航'}).getByRole('button',{name:'进店欢迎'}).click();
 await page.getByLabel('欢迎语',{exact:true}).fill('欢迎，测试配置。');await page.getByRole('button',{name:'保存配置'}).click();await expect(page.getByText('已保存到当前演示店铺的本地配置')).toBeVisible();
 await page.getByLabel('欢迎语',{exact:true}).fill('未保存内容');await page.getByRole('navigation',{name:'配置导航'}).getByRole('button',{name:'数据看板'}).click();await expect(page.getByRole('dialog',{name:'当前页面有未保存修改'})).toBeVisible();
 await page.getByRole('button',{name:'继续编辑',exact:true}).click();await expect(page.getByLabel('欢迎语',{exact:true})).toHaveValue('未保存内容');await page.getByRole('button',{name:'恢复已保存'}).click();await expect(page.getByLabel('欢迎语',{exact:true})).toHaveValue('欢迎，测试配置。');
 await page.reload();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'配置中心'}).click();await page.getByRole('navigation',{name:'配置导航'}).getByRole('button',{name:'进店欢迎'}).click();await expect(page.getByLabel('欢迎语',{exact:true})).toHaveValue('欢迎，测试配置。');
});
test('rejects invalid design and imports a valid fixture',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'本地设计交付',exact:true}).first().click();
 await page.getByLabel('设计快照文件').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});await expect(page.getByRole('alert')).toContainText('快照');
 const data={schema:'lingtu.design-snapshot',version:1,fileName:'自动化测试快照（非真实设计）',nodes:[{id:'1:2',name:'UX01 测试画板',width:1920,height:1080,document:{type:'FRAME'}}]};
 await page.getByLabel('设计快照文件').setInputFiles({name:'test.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});await expect(page.getByRole('heading',{name:data.fileName})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
});
