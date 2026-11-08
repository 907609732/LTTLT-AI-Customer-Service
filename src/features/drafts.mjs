const copy=value=>structuredClone(value);
export function createDraftStore(){
 const entries=new Map();const listeners=new Set();let serial=0;
 function entry(key){if(!entries.has(key))entries.set(key,{draft:{},saved:{},dirty:false,saving:false,error:'',revision:0,request:0});return entries.get(key);}
 function changed(){for(const fn of listeners)fn();}
 return {
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn)},
  get(key){return copy(entry(key))},
  seed(key,initial){const e=entry(key);let didChange=false;for(const [field,value] of Object.entries(initial))if(!(field in e.draft)){e.draft[field]=copy(value);e.saved[field]=copy(value);didChange=true;}if(didChange)changed();},
  hydrate(key,values){const e=entry(key);if(e.saving)return;const clean=!e.dirty;e.saved={...e.saved,...copy(values)};if(clean)e.draft=copy(e.saved);e.dirty=JSON.stringify(e.draft)!==JSON.stringify(e.saved);e.revision++;changed();},
  edit(key,values){const e=entry(key);e.draft={...e.draft,...copy(values)};e.revision++;e.dirty=JSON.stringify(e.draft)!==JSON.stringify(e.saved);e.error='';changed();},
  restore(key){const e=entry(key);e.draft=copy(e.saved);e.revision++;e.dirty=false;e.error='';changed();},
  async save(key,writer){
   const e=entry(key);const sent=copy(e.draft);const revision=e.revision;const request=++serial;
   e.request=request;e.saving=true;e.error='';changed();
   try{
    const result=await writer(copy(sent));
    if(e.request===request){e.saved=sent;if(e.revision===revision)e.draft=copy(sent);e.dirty=JSON.stringify(e.draft)!==JSON.stringify(e.saved);e.saving=false;changed();}
    return result;
   }catch(error){if(e.request===request){e.saving=false;e.error=error instanceof Error?error.message:String(error);changed();}throw error;}
  }
 };
}
export function parseBannedWords(text){
 const words=new Map();
 for(const raw of text.split(/[\n,，;；]+/)){
  const match=raw.trim().match(/^(.+?)(?:\s*(?:=>|→|=)\s*(.*))?$/);
  if(!match)continue;const word=match[1].trim();if(!word)continue;
  words.set(word,{word,replacement:(match[2]||'').trim()});
 }
 return [...words.values()];
}
