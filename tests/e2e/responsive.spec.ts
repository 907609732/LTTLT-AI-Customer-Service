import {test,expect} from '@playwright/test';
for(const [width,height] of [[1920,1080],[2560,1440]]){
 test(`product fills ${width}x${height} without scaling typography`,async({page})=>{
  await page.setViewportSize({width,height});await page.goto('/');
  const root=page.locator('[data-figma-node="8836:4283"]');await expect(root).toBeVisible();
  await expect.poll(async()=>Math.round((await root.boundingBox())!.width)).toBe(width);
  await expect.poll(async()=>Math.round((await root.boundingBox())!.height)).toBe(height);
  const sidebar=page.locator('[data-figma-node="11:65"]');expect((await sidebar.boundingBox())!.width).toBe(300);
  const title=page.locator('[data-figma-node="11:224"]');expect(await title.evaluate(e=>getComputedStyle(e).fontSize)).toBe('30px');
  const main=page.locator('[data-figma-node="11:217"]');const a=(await main.boundingBox())!,b=(await title.boundingBox())!;expect(Math.abs(b.x+b.width/2-a.x-a.width/2)).toBeLessThan(2);
  await page.goto('/?screen=UX16');const content=page.locator('[data-figma-node="8801:1803"]');await expect(content).toBeVisible();expect((await content.boundingBox())!.width).toBe(width-186);
  const conversation=page.locator('[data-figma-node="8801:1804"]');const input=page.getByRole('textbox',{name:'训练问题',exact:true});await expect(input).toBeVisible();
  expect((await conversation.boundingBox())!.height).toBe(533+height-900);
  await input.fill('窗口放大后测试');await page.setViewportSize({width:1440,height:900});await expect(input).toHaveValue('窗口放大后测试');
 });
}

import manifest from '../../src/design/generated/manifest.json' with {type:'json'};
for(const screen of manifest.files.filter(s=>s.width===1440)){
 test(`expanded source ${screen.uxId} uses the full main window`,async({page})=>{
  await page.setViewportSize({width:1920,height:1080});await page.goto('/?screen='+screen.uxId);
  const root=page.locator('[data-figma-node="'+screen.nodeId+'"]').first();await expect(root).toBeVisible();
  expect((await root.boundingBox())!.width).toBe(1920);expect((await root.boundingBox())!.height).toBe(1080);
  await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:'test-results/responsive/'+screen.uxId+'-1920.png'});
 });
}

test('configuration navigation captions keep their row positions while height grows',async({page})=>{
 await page.setViewportSize({width:1920,height:1080});await page.goto('/?screen=UX16');
 const nav=page.locator('[data-figma-node="8835:25961"]');const caption=page.locator('[data-figma-node="I8835:25961;8835:25589"]');await expect(caption).toBeVisible();
 const row=page.locator('[data-figma-node="I8835:25961;8835:25574"]');expect(Math.round((await row.boundingBox())!.y-(await caption.boundingBox())!.y)).toBe(24);
});
