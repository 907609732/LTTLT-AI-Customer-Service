import {test} from 'node:test';import assert from 'node:assert/strict';
import {constrainProperties} from '../src/design/layout.mjs';
const props={size:{x:100,y:40},transform:{m00:1,m01:0,m02:20,m10:0,m11:1,m12:30},fontSize:14};
for(const [constraint,x,w] of [['LEFT',20,100],['RIGHT',220,100],['CENTER',120,100],['LEFT_RIGHT',20,300],['SCALE',40,200]]){
 test('Figma '+constraint+' geometry preserves source typography and input',()=>{
  const p={...props,constraints:{horizontal:constraint,vertical:'BOTTOM'}};const r=constrainProperties(p,{x:200,y:100},{x:400,y:150});
  assert.equal(r.transform.m02,x);assert.equal(r.size.x,w);assert.equal(r.transform.m12,80);assert.equal(r.fontSize,14);assert.equal(p.size.x,100);assert.equal(p.transform.m02,20);
 });
}
