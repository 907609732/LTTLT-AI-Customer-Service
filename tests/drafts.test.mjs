import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftStore,parseBannedWords} from '../src/features/drafts.mjs';

test('drafts remain independent by store and cancel restores the last successful save',async()=>{
 const store=createDraftStore();
 store.edit('welcome:store-a',{text:'你好',enabled:true});
 store.edit('welcome:store-b',{text:'另一家店',enabled:false});
 await store.save('welcome:store-a',async value=>({...value,version:1}));
 store.edit('welcome:store-a',{text:'尚未保存'});
 store.restore('welcome:store-a');
 assert.equal(store.get('welcome:store-a').draft.text,'你好');
 assert.equal(store.get('welcome:store-b').draft.text,'另一家店');
 assert.equal(store.get('welcome:store-a').dirty,false);
});
test('failed saves retain draft and never advance the saved snapshot',async()=>{
 const store=createDraftStore();store.edit('image:store-a',{prompt:'看包装'});
 await assert.rejects(store.save('image:store-a',async()=>{throw Error('连接失败')}),/连接失败/);
 assert.equal(store.get('image:store-a').draft.prompt,'看包装');
 assert.deepEqual(store.get('image:store-a').saved,{});
 assert.equal(store.get('image:store-a').dirty,true);
});
test('an older save response cannot overwrite more recent edits',async()=>{
 const store=createDraftStore();let finish;
 store.edit('model:a',{prompt:'第一版'});
 const pending=store.save('model:a',()=>new Promise(resolve=>{finish=resolve}));
 store.edit('model:a',{prompt:'继续编辑'});finish({version:1});await pending;
 assert.equal(store.get('model:a').draft.prompt,'继续编辑');
 assert.equal(store.get('model:a').saved.prompt,'第一版');
 assert.equal(store.get('model:a').dirty,true);
});
test('banned words accept newlines, commas and explicit replacement without duplicates',()=>{
 assert.deepEqual(parseBannedWords('微信=wx，最强\n微信→wx\n最好=>较好'),[
  {word:'微信',replacement:'wx'},{word:'最强',replacement:''},{word:'最好',replacement:'较好'}
 ]);
});
test('remote hydration refreshes clean fields and preserves dirty drafts',()=>{const d=createDraftStore();d.seed('global',{prompt:'old'});assert.equal(typeof d.hydrate,'function');d.hydrate('global',{prompt:'remote'});assert.equal(d.get('global').draft.prompt,'remote');d.edit('global',{prompt:'local edit'});d.hydrate('global',{prompt:'new remote'});assert.equal(d.get('global').draft.prompt,'local edit');d.restore('global');assert.equal(d.get('global').draft.prompt,'new remote');});
