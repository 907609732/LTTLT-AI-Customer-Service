export type Store={id:string;name:string;platform:string;status:'online'|'offline'};
export type AppSettings={mode:string;lastSentence:boolean;welcome:string;autoTransfer:boolean};
export type DesignNode={id:string;name:string;width:number;height:number;preview:string;document:Record<string,unknown>;warning:string};
export type Snapshot={schema:string;version:number;fileName:string;pageName:string;exportedAt:string;nodes:DesignNode[]};
declare global{interface Window{lingtu?:{info:()=>Promise<{version:string;platform:string;mode:string}>;importDesign:()=>Promise<{canceled:boolean;snapshot?:Snapshot}>;windowAction:(action:'minimize'|'maximize'|'close')=>Promise<void>}}}
