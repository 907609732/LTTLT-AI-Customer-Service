import test from 'node:test';
import assert from 'node:assert/strict';
import {initialInteractionState,applyInteraction} from '../src/design/interaction.mjs';

const context={routes:{home:'UX01',settings:'UX04',aux:'UX26'},targets:new Set(['home','settings','aux','menu-open','modal']),
 sets:{'menu-open':'mode-menu','menu-closed':'mode-menu'},ancestors:[{id:'instance-a',componentId:'menu-closed'}]};
test('navigation and back preserve actual source route while overlay close does not navigate',()=>{
 let s=initialInteractionState();
 s=applyInteraction(s,{type:'NODE',navigation:'NAVIGATE',destinationId:'settings'},context);
 assert.equal(s.screenId,'UX04');
 s=applyInteraction(s,{type:'NODE',navigation:'OVERLAY',destinationId:'modal'},context);
 assert.deepEqual(s.overlays,['modal']);
 s=applyInteraction(s,{type:'CLOSE'},context);
 assert.equal(s.screenId,'UX04');assert.deepEqual(s.overlays,[]);
 s=applyInteraction(s,{type:'BACK'},context);
 assert.equal(s.screenId,'UX01');
});
test('component changes are scoped to the matching instance and reject unrelated targets',()=>{
 const s=initialInteractionState();
 const changed=applyInteraction(s,{type:'NODE',navigation:'CHANGE_TO',destinationId:'menu-open'},context);
 assert.equal(changed.variants['instance-a'],'menu-open');assert.equal(changed.variants['instance-b'],undefined);
 assert.deepEqual(s.variants,{});
 const noMatch=applyInteraction(s,{type:'NODE',navigation:'CHANGE_TO',destinationId:'menu-open'},{...context,ancestors:[{id:'instance-b',componentId:'other'}]});
 assert.deepEqual(noMatch.variants,{});
});
test('unknown destination cannot change route, and opening auxiliary state uses the source mapping',()=>{
 const s=initialInteractionState();
 assert.equal(applyInteraction(s,{type:'NODE',navigation:'NAVIGATE',destinationId:'missing'},context).screenId,'UX01');
 assert.equal(applyInteraction(s,{type:'NODE',navigation:'NAVIGATE',destinationId:'aux'},context).screenId,'UX26');
});
