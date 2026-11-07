import {test,expect} from '@playwright/test';
import manifest from '../../src/design/generated/manifest.json' with {type:'json'};

for(const screen of manifest.files){
 test('current product source '+screen.uxId+' renders all local resources at its approved viewport',async({page})=>{
  const errors:string[]=[];const failed:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push(r.url()));
  await page.setViewportSize({width:screen.width,height:screen.height});
  await page.goto('/?screen='+screen.uxId);
  await expect(page.locator('[data-figma-node="'+screen.nodeId+'"]').first()).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({path:'test-results/screens/'+screen.uxId+'.png'});
  expect(errors).toEqual([]);expect(failed).toEqual([]);
 });
}
