export type DraftEntry={draft:Record<string,unknown>;saved:Record<string,unknown>;dirty:boolean;saving:boolean;error:string;revision:number;request:number};
export function createDraftStore():{subscribe(fn:()=>void):()=>void;get(key:string):DraftEntry;seed(key:string,initial:Record<string,unknown>):void;edit(key:string,values:Record<string,unknown>):void;restore(key:string):void;save<T>(key:string,writer:(value:Record<string,unknown>)=>Promise<T>):Promise<T>};
export function parseBannedWords(text:string):{word:string;replacement:string}[];
